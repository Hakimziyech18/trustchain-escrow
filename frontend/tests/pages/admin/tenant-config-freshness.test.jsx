import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams } from 'next/navigation';
import TenantConfigurationPage from '../../../app/admin/tenants/[tenantId]/page';
import { AppStoreProvider } from '../../../store/app-store';

jest.mock('next/navigation', () => ({ useParams: jest.fn() }));

const tenant = (name) => ({ tenant: {
  name,
  status: 'active',
  updatedAt: '2026-10-01T00:00:00.000Z',
  configuration: { featureFlag: true },
} });

beforeEach(() => {
  global.fetch = jest.fn();
  window.localStorage.clear();
  useParams.mockReturnValue({ tenantId: 'tenant-a' });
});

test('newer tenant response wins over an older response that ignores abort', async () => {
  let finishOld;
  global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => tenant('Tenant B') });
  const view = render(<AppStoreProvider><TenantConfigurationPage /></AppStoreProvider>);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  const signal = global.fetch.mock.calls[0][1].signal;
  useParams.mockReturnValue({ tenantId: 'tenant-b' });
  view.rerender(<AppStoreProvider><TenantConfigurationPage /></AppStoreProvider>);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(signal.aborted).toBe(true);
  await screen.findByText('Tenant: Tenant B');
  await act(async () => finishOld({ ok: true, json: async () => tenant('Tenant A') }));
  expect(screen.getByText('Tenant: Tenant B')).toBeInTheDocument();
  expect(screen.queryByText('Tenant: Tenant A')).not.toBeInTheDocument();
});

test('refresh discards an earlier error and shows a newer success', async () => {
  let rejectOld;
  global.fetch.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => tenant('Current') });
  render(<AppStoreProvider><TenantConfigurationPage /></AppStoreProvider>);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('Refresh configuration'));
  await screen.findByText('Tenant: Current');
  await act(async () => rejectOld(new Error('secret should never appear')));
  expect(screen.queryByText('secret should never appear')).not.toBeInTheDocument();
});

test('navigation aborts the outstanding tenant configuration request', async () => {
  global.fetch.mockImplementation(() => new Promise(() => {}));
  const view = render(<AppStoreProvider><TenantConfigurationPage /></AppStoreProvider>);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  const signal = global.fetch.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

test('malformed response shows a stable safe error', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ invalid: true }) });
  render(<AppStoreProvider><TenantConfigurationPage /></AppStoreProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load tenant configuration');
});
