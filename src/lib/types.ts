export type TableName = 'leads' | 'contacts' | 'opportunities' | 'activities' | 'tasks' | 'suggestions' | 'settings';
export const TABLES: TableName[] = ['leads', 'contacts', 'opportunities', 'activities', 'tasks', 'suggestions', 'settings'];

export interface BaseRecord {
  id: string;
  createdAt?: string;
  updatedAt: string;
  deleted?: boolean;
}

export type LeadStatus = 'New' | 'Attempting' | 'Connected' | 'Qualified' | 'Nurture' | 'Disqualified' | 'Converted';
export type Quality = '' | 'good' | 'bad';

export interface Lead extends BaseRecord {
  company: string;
  contactName: string;
  phone: string;
  altPhone: string;
  email: string;
  website: string;
  trade: string;
  city: string;
  state: string;
  address: string;
  source: string;
  status: LeadStatus;
  quality: Quality;
  disqualifyReason: string;
  tags: string;
  attempts: number;
  lastContactedAt: string;
  lastOutcome: string;
  nextFollowUpAt: string;
  notes: string;
  convertedContactId: string;
  // Public-record fields (Lead Finder)
  origin?: '' | 'public';
  score?: number;
  licenseNo?: string;
  ubi?: string;
  specialty?: string;
  licenseStart?: string;
  ownership?: string;
  sources?: string;
  naics?: string;
  zip?: string;
  lapsedAt?: string;
  notListedSince?: string;
  /** Set when you add it to "My queue" in Call Mode; cleared once a call is logged. */
  queuedAt?: string;
}

export type ContactStatus = 'Prospect' | 'Active Client' | 'Past Client';

export interface Contact extends BaseRecord {
  company: string;
  contactName: string;
  title: string;
  phone: string;
  altPhone: string;
  email: string;
  website: string;
  trade: string;
  city: string;
  state: string;
  address: string;
  status: ContactStatus;
  leadId: string;
  tags: string;
  lastContactedAt: string;
  lastOutcome: string;
  nextFollowUpAt: string;
  notes: string;
  queuedAt?: string;
}

export interface Opportunity extends BaseRecord {
  contactId: string;
  name: string;
  service: string;
  stage: string;
  monthlyValue: number;
  setupFee: number;
  probability: number;
  expectedCloseDate: string;
  nextStep: string;
  lostReason: string;
  closedAt: string;
  notes: string;
}

export type EntityType = 'lead' | 'contact' | 'opportunity';

export type ActivityType =
  | 'call' | 'note' | 'email' | 'text' | 'meeting'
  | 'status' | 'converted' | 'opportunity' | 'stage' | 'task' | 'created';

export interface Activity extends BaseRecord {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  type: ActivityType;
  outcome: string;
  notes: string;
  durationSec: number;
  phone: string;
  occurredAt: string;
  // email activities
  threadId?: string;
  messageId?: string;
  direction?: 'in' | 'out';
  emailFrom?: string;
  emailTo?: string;
}

export interface Task extends BaseRecord {
  entityType: EntityType | '';
  entityId: string;
  entityName: string;
  title: string;
  dueAt: string;
  priority: 'Low' | 'Normal' | 'High';
  done: boolean;
  doneAt: string;
  notes: string;
}

export type Decision = 'Pending' | 'Approved' | 'Rejected' | 'Implemented' | 'Duplicate';

export interface Suggestion extends BaseRecord {
  page: string;
  suggestion: string;
  decision: Decision;
  decisionNotes: string;
  decidedAt: string;
}

export interface SettingRow extends BaseRecord {
  value: string;
}

export interface RecordMap {
  leads: Lead;
  contacts: Contact;
  opportunities: Opportunity;
  activities: Activity;
  tasks: Task;
  suggestions: Suggestion;
  settings: SettingRow;
}
