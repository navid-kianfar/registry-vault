import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RegistryType } from '@registry-vault/shared/enums';
import type { AgentFeature, AgentStatus } from '@registry-vault/shared';

/** Scheduled garbage collection cadence; `off` is the default. */
export type GcSchedule = 'off' | 'daily' | 'weekly';

@Entity('registry_connections')
export class RegistryConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  registryType!: RegistryType;

  @Column()
  name!: string;

  @Column()
  url!: string;

  @Column({ default: false })
  isDefault!: boolean;

  @Column({ default: false })
  isConnected!: boolean;

  @Column({ type: 'varchar', nullable: true })
  username?: string | null;

  // ---- Registry agent (agent/API.md). Docker connections only. ----

  /** Management API of the agent beside this registry, e.g. http://registry:5080 */
  @Column({ type: 'varchar', nullable: true })
  agentUrl?: string | null;

  /** Bearer key for the agent's management API, encrypted at rest. Never returned, never logged. */
  @Column({ type: 'varchar', nullable: true })
  encryptedAgentApiKey?: string | null;

  // An explicit column type: TypeORM cannot infer one from a string union.
  @Column({ type: 'varchar', default: 'off' })
  gcSchedule!: GcSchedule;

  /** Hour of day (0-23, server local time) for scheduled GC. */
  @Column({ type: 'int', default: 3 })
  gcHour!: number;

  /** Day for weekly GC: 0 = Sunday … 6 = Saturday. Ignored unless the schedule is weekly. */
  @Column({ type: 'int', default: 0 })
  gcWeekday!: number;

  @Column({ default: true })
  gcAfterRetention!: boolean;

  @Column({ type: 'int', default: 85 })
  lowDiskWarningPercent!: number;

  @Column({ default: false })
  autoScanOnPush!: boolean;

  /** Last scheduled (not manual) GC, so the hourly scheduler fires once per window. */
  @Column({ nullable: true })
  lastScheduledGcAt?: string;

  // ---- Cached agent info, refreshed by every agent call ----

  @Column({ type: 'varchar', nullable: true })
  agentVersion?: string | null;

  @Column({ type: 'varchar', nullable: true })
  agentRegistryVersion?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  agentFeatures?: AgentFeature[] | null;

  @Column({ type: 'varchar', nullable: true })
  agentStatus?: AgentStatus | null;

  @Column({ type: 'varchar', nullable: true })
  agentLastSeenAt?: string | null;

  /**
   * When pull tracking began. A tag pushed before this was never observed, so
   * retention by "not pulled for N days" must not delete it on the strength of
   * a missing pull we could not have seen.
   */
  @Column({ type: 'varchar', nullable: true })
  agentConfiguredAt?: string | null;

  /** Highest agent event `seq` ingested. */
  @Column({ type: 'bigint', default: 0 })
  agentEventCursor!: number;

  /** The agent pruned events before Vault read them, so pull counts are a lower bound. */
  @Column({ default: false })
  eventsIncomplete!: boolean;

  /**
   * When the most recent gap was noticed. Pull history before this moment is
   * missing events, so any decision that depends on "nobody pulled this" is
   * only sound for a window starting after it. Sticky like `eventsIncomplete`,
   * but it moves forward with each new gap.
   */
  @Column({ type: 'varchar', nullable: true })
  eventsIncompleteSince?: string | null;

  /** Created from EMBEDDED_REGISTRY_URL in the all-in-one image. */
  @Column({ default: false })
  isEmbedded!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
