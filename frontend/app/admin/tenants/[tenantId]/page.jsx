'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAdminStore } from '../../../../store/app-store';
import { adminFetch } from '../../../../store/admin';

/** Read-only tenant configuration health view. Does not expose config values. */
export default function TenantConfigurationPage() {
  const { tenantId } = useParams();
  const { apiKey } = useAdminStore();
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setTenant(null);
    setLoading(true);
    setError('');

    async function load() {
      try {
        if (typeof tenantId !== 'string' || !tenantId) {
          throw new Error('Tenant not specified');
        }
        const response = await adminFetch(
          `/api/admin/tenants/${encodeURIComponent(tenantId)}`,
          apiKey,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error('Unable to load tenant configuration');
        const data = await response.json();
        if (!data?.tenant || typeof data.tenant !== 'object') {
          throw new Error('Invalid tenant configuration response');
        }
        if (current) setTenant(data.tenant);
      } catch (err) {
        if (current && !controller.signal.aborted) {
          // Deliberately do not render network/server error details or credentials.
          setError(err.message === 'Tenant not specified' ? err.message : 'Unable to load tenant configuration');
        }
      } finally {
        if (current) setLoading(false);
      }
    }
    load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [tenantId, apiKey, revision]);

  return (
    <div>
      <h1>Tenant configuration</h1>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Refresh configuration
      </button>
      {loading && <p>Loading tenant configuration…</p>}
      {error && <p role="alert">{error}</p>}
      {tenant && !loading && (
        <section aria-label="Tenant configuration summary">
          <p>Tenant: {tenant.name}</p>
          <p>Status: {tenant.status}</p>
          <p>Updated: {tenant.updatedAt || 'Unknown'}</p>
          <p>
            Configuration fields: {Object.keys(tenant.configuration || {}).sort().join(', ') || 'None'}
          </p>
        </section>
      )}
    </div>
  );
}
