// Experience Record
export interface ExperienceRecord {
  id: string; // "exp_{timestamp}_{hash8}"
  type: 'experience';
  schema_version: string; // "1.1.0"
  signals: string[]; // canonical signal names
  scope: 'project' | 'language' | 'universal';
  preconditions?: string[];
  strategy: {
    name: string; // snake_case
    description: string;
    category: 'repair' | 'optimize' | 'innovate';
  };
  outcome: {
    status: 'success' | 'failed' | 'partial';
    evidence?: string;
    evidence_digest?: string; // "sha256:..."
    blast_radius?: {
      files: number;
      lines: number;
    };
  };
  confidence: number; // 0-1
  source_agent: string;
  signature: string; // "hmac-sha256:..." or "ed25519:..."
  validated_by: string | null;
  promoted: boolean;
  provisional: boolean;
  provisional_deadline: string | null; // ISO 8601
  supersedes: string | null; // exp_id
  superseded_by: string | null; // exp_id
  risk_level?: 'low' | 'medium' | 'high';
  created: string; // ISO 8601
  last_confirmed: string; // ISO 8601
  decay_halflife_days: number; // default 30
  archived: boolean;
  archived_reason: 'zero_ref' | 'low_confidence' | 'consecutive_fail' | 'superseded' | null;
}

// Event Envelope (§4.5)
export interface HiveEvent<T = unknown> {
  event_id: string; // "evt_{timestamp}_{hash8}"
  type: EventType;
  timestamp: string; // ISO 8601
  source_agent: string;
  signature: string;
  payload: T;
}

export type EventType =
  | 'experience.created'
  | 'experience.referenced'
  | 'experience.outcome_recorded'
  | 'experience.promoted'
  | 'experience.provisional'
  | 'experience.provisional_expired'
  | 'experience.archived'
  | 'experience.quarantined'
  | 'experience.superseded'
  | 'confidence.decayed'
  | 'strategy.banned';

// Event Payloads (§4.5)
export interface ExperienceCreatedPayload {
  exp_id: string;
  initial_confidence: number;
}

export interface ExperienceReferencedPayload {
  exp_id: string;
  context_summary: string;
}

export interface ExperienceOutcomePayload {
  exp_id: string;
  ref_event_id: string;
  result: 'success' | 'failed' | 'partial';
}

export interface ExperiencePromotedPayload {
  exp_id: string;
  promoted_by: string; // "human"
}

export interface ExperienceProvisionalPayload {
  exp_id: string;
  consensus_agents: string[];
  deadline: string;
}

export interface ExperienceProvisionalExpiredPayload {
  exp_id: string;
}

export interface ExperienceArchivedPayload {
  exp_id: string;
  reason: 'zero_ref' | 'low_confidence' | 'consecutive_fail' | 'superseded';
}

export interface ExperienceQuarantinedPayload {
  exp_id: string;
  reason: string;
}

export interface ExperienceSupersededPayload {
  old_exp_id: string;
  new_exp_id: string;
  reason: string;
  auto_superseded: boolean;
}

export interface ConfidenceDecayedPayload {
  affected_exp_ids: string[];
  decay_factor: number;
}

export interface StrategyBannedPayload {
  strategy_name: string;
  reason: string;
  banned_by: string;
}

// SignerInterface (abstract — no HMAC details)
export interface SignerInterface {
  sign(data: string): string;
  verify(data: string, signature: string): boolean;
}

// Signal Convention
export interface SignalConvention {
  name: string; // canonical name, e.g. "tsc_error"
  aliases: string[]; // alternative names that map to this
  detect_pattern: string; // regex for auto-detection
  description: string;
  category: string; // "build" | "test" | "lint" | "runtime" | "security"
}
