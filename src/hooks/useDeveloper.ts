'use client';

import { useState, useEffect, useCallback } from 'react';
import { ApiKey, Application, ServiceAccount } from '@/types/database';
import { toast } from 'sonner';

export function useDeveloper() {
  const [apiKeys, setApiKeys] = useState<Omit<ApiKey, 'key_hash'>[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [serviceAccounts, setServiceAccounts] = useState<ServiceAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, appsRes] = await Promise.all([
        fetch('/api/v1/developer/keys'),
        fetch('/api/v1/developer/apps'),
      ]);

      const keysJson = await keysRes.json();
      const appsJson = await appsRes.json();

      if (keysRes.ok) setApiKeys(keysJson.data || []);
      if (appsRes.ok) {
        setApplications(appsJson.data?.applications || []);
        setServiceAccounts(appsJson.data?.serviceAccounts || []);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const createApiKey = async (name: string, serviceAccountId: string, scopes: string[]) => {
    try {
      const res = await fetch('/api/v1/developer/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, service_account_id: serviceAccountId, scopes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to create API key');

      // Update list and refresh related service accounts
      setApiKeys((prev) => [json.data.apiKey, ...prev]);
      await fetchData();
      return json.data as { rawKey: string; apiKey: Omit<ApiKey, 'key_hash'> };
    } catch (err: any) {
      toast.error(err.message);
      return null;
    }
  };

  const revokeApiKey = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/developer/keys?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to revoke API key');

      toast.success('API key revoked');
      setApiKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: 'revoked', revoked_at: new Date().toISOString() } : k))
      );
      return true;
    } catch (err: any) {
      toast.error(err.message);
      return false;
    }
  };

  const createApplication = async (name: string, environment: 'development' | 'staging' | 'production' = 'production') => {
    try {
      const res = await fetch('/api/v1/developer/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, environment }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to create application');

      toast.success(`Application "${name}" registered`);
      setApplications((prev) => [...prev, json.data.application]);
      setServiceAccounts((prev) => [...prev, json.data.serviceAccount]);
      return json.data;
    } catch (err: any) {
      toast.error(err.message);
      return null;
    }
  };

  return {
    apiKeys,
    applications,
    serviceAccounts,
    loading,
    fetchData,
    createApiKey,
    revokeApiKey,
    createApplication,
  };
}
