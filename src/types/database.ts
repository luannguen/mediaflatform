// Database Entities & Types for Media Platform
export type AssetType = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';
export type Visibility = 'private' | 'workspace' | 'public';
export type AssetStatus = 'uploading' | 'active' | 'archived' | 'trashed' | 'deleted' | 'failed';
export type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'partial' | 'failed';
export type AppEnvironment = 'development' | 'staging' | 'production';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logo_asset_id?: string | null;
  status: 'active' | 'suspended' | 'archived';
  owner_user_id: string;
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: 'active' | 'suspended' | 'archived';
  default_visibility: Visibility;
  storage_policy: string;
  retention_policy?: {
    trash_retention_days?: number;
    unused_asset_retention_days?: number;
  };
  quota_storage_bytes: number;
  quota_asset_count: number;
  settings?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  key: string;
  label: string;
  description?: string | null;
  permissions: Record<string, boolean>;
  is_system: boolean;
  created_at: string;
}

export interface WorkspaceMembership {
  id: string;
  workspace_id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
  role_id: string;
  role?: string;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  invited_by?: string | null;
  joined_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceInvitation {
  id: string; // inv_...
  workspace_id: string;
  workspace_name: string;
  inviter_user_id: string;
  inviter_name: string;
  invitee_email: string;
  role: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  created_at: string;
  expires_at: string;
}


export interface Folder {
  id: string;
  workspace_id: string;
  parent_folder_id?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Collection {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  cover_asset_id?: string | null;
  visibility: Visibility;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  normalized_name: string;
  description?: string | null;
  created_at: string;
}

export interface Asset {
  id: string; // med_...
  workspace_id: string;
  project_id?: string | null;
  folder_id?: string | null;
  asset_type: AssetType;
  original_filename: string;
  display_name: string;
  description?: string | null;
  mime_type: string;
  extension: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  storage_provider: string;
  storage_bucket: string;
  storage_key: string;
  storage_url?: string | null;
  checksum_algorithm: string;
  checksum?: string | null;
  visibility: Visibility;
  status: AssetStatus;
  processing_status: ProcessingStatus;
  created_by_user_id?: string | null;
  created_by_service_account_id?: string | null;
  metadata_json?: Record<string, any>;
  deleted_at?: string | null;
  purge_after?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetVariant {
  id: string;
  asset_id: string;
  variant_name: string; // original, thumbnail, small, medium, large
  storage_provider: string;
  storage_key: string;
  storage_url?: string | null;
  mime_type: string;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  size_bytes: number;
  quality: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AssetVersion {
  id: string; // ver_...
  asset_id: string;
  version_number: number;
  storage_key: string;
  storage_url?: string | null;
  size_bytes: number;
  mime_type: string;
  checksum?: string | null;
  width?: number | null;
  height?: number | null;
  created_by?: string | null;
  comment?: string | null;
  created_at: string;
}

export interface UsageMetric {
  id: string;
  workspace_id: string;
  asset_id?: string | null;
  event_type: 'delivery' | 'cache_hit' | 'upload' | 'replace' | 'delete';
  bytes_transferred: number;
  bytes_saved: number;
  format?: string | null;
  latency_ms: number;
  user_agent?: string | null;
  created_at: string;
}

export interface Application {
  id: string; // app_...
  workspace_id: string;
  name: string;
  slug: string;
  description?: string | null;
  environment: AppEnvironment;
  status: 'active' | 'suspended' | 'archived';
  allowed_origins: string[];
  allowed_callback_urls: string[];
  default_scopes: string[];
  rate_limit_policy?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ServiceAccount {
  id: string; // svc_...
  workspace_id: string;
  application_id: string;
  name: string;
  description?: string | null;
  status: 'active' | 'suspended' | 'archived';
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string; // key_...
  workspace_id: string;
  service_account_id: string;
  name: string;
  key_prefix: string; // mda_live_xxxx
  key_hash: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  expires_at?: string | null;
  last_used_at?: string | null;
  created_by?: string | null;
  created_at: string;
  revoked_at?: string | null;
  revoked_by?: string | null;
}

export interface AssetReference {
  id: string; // ref_...
  workspace_id: string;
  asset_id: string;
  application_id?: string | null;
  source_app: string;
  entity_type: string;
  entity_id: string;
  field_name?: string | null;
  context?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface WebhookEndpoint {
  id: string; // wh_...
  workspace_id: string;
  application_id?: string | null;
  name: string;
  url: string;
  events: string[];
  secret_hash: string;
  status: 'active' | 'disabled' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_endpoint_id: string;
  event_type: string;
  event_id: string;
  payload: Record<string, any>;
  status: 'pending' | 'delivered' | 'failed';
  http_status?: number | null;
  attempt_count: number;
  last_attempt_at?: string | null;
  next_attempt_at?: string | null;
  response_summary?: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: string; // evt_...
  workspace_id: string;
  actor_type: 'user' | 'service_account' | 'system';
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  changes_summary?: Record<string, any>;
  request_id?: string | null;
  created_at: string;
}

export interface ApiRequestLog {
  id: string;
  request_id: string; // req_...
  workspace_id: string;
  application_id?: string | null;
  service_account_id?: string | null;
  method: string;
  route: string;
  status_code: number;
  duration_ms: number;
  user_agent?: string | null;
  error_code?: string | null;
  created_at: string;
}

export type JobType = 'video_transcode' | 'image_optimization' | 'audio_transcode' | 'document_extract';
export type JobStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

export type RetryableErrorTaxonomy =
  | 'STORAGE_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'WORKER_INTERRUPTED'
  | 'TEMPORARY_IO_ERROR'
  | 'RATE_LIMITED';

export type PermanentErrorTaxonomy =
  | 'INVALID_VIDEO'
  | 'CORRUPTED_SOURCE'
  | 'UNSUPPORTED_CODEC'
  | 'INVALID_CONTAINER'
  | 'SOURCE_NOT_FOUND'
  | 'HLS_VALIDATION_FAILED';

export type ErrorTaxonomy = RetryableErrorTaxonomy | PermanentErrorTaxonomy;

export type JobStage =
  | 'queued'
  | 'probing'
  | 'transcoding'
  | 'packaging'
  | 'poster_generation'
  | 'preview_generation'
  | 'uploading_outputs'
  | 'validating'
  | 'ready';

export interface ProcessingJob {
  id: string; // job_...
  asset_id: string;
  workspace_id: string;
  job_type: JobType;
  status: JobStatus;
  current_stage: JobStage;
  progress: number; // 0 - 100
  source_storage_key: string;
  source_storage_url?: string | null;
  target_profiles?: string[];
  priority: number;
  attempt: number;
  attempt_count?: number;
  max_attempts: number;
  locked_by?: string | null;
  locked_at?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at: string;
  available_at: string;
  job_run_id?: string | null;
  output_version?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  error_taxonomy?: ErrorTaxonomy | string | null;
  error_message?: string | null;
  error_details?: Record<string, any>;
  input?: Record<string, any>;
  output?: Record<string, any>;
  metadata_json?: {
    probe_data?: {
      width?: number;
      height?: number;
      duration_ms?: number;
      codec?: string;
      fps?: number;
      bitrate?: number;
      aspect_ratio?: string;
    };
    output_manifest?: {
      master_m3u8?: string;
      variants?: Array<{
        profile: string;
        resolution: string;
        bandwidth: number;
        avg_bandwidth?: number;
        codecs?: string;
        url: string;
      }>;
      poster_url?: string;
      trailer_url?: string;
      target_profiles?: string[];
      non_upscaling_enforced?: boolean;
      source_height?: number;
    };
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
}

export interface AssetVersion {
  id: string; // ver_...
  asset_id: string;
  version_number: number;
  storage_key: string;
  storage_url?: string | null;
  size_bytes: number;
  mime_type: string;
  checksum?: string | null;
  width?: number | null;
  height?: number | null;
  created_by?: string | null;
  comment?: string | null;
  created_at: string;
}

export interface UsageMetric {
  id: string; // met_...
  workspace_id: string;
  asset_id?: string | null;
  event_type: 'delivery' | 'cache_hit' | 'upload' | 'replace' | 'delete';
  bytes_transferred: number;
  bytes_saved: number;
  format?: string | null;
  latency_ms: number;
  user_agent?: string | null;
  created_at: string;
}

