import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The `tag` of the row that counts a repository's pull *events* for a day.
 *
 * A pull by digest is credited to every tag resolving to it, so per-tag rows
 * can add up to more than the number of pulls that actually happened. This row
 * counts each event once, which is what the repository total and the daily
 * series report. `*` is not a legal Docker tag, so it cannot collide.
 */
export const REPOSITORY_TOTAL_TAG = '*';

/**
 * One row per repository, tag and day, counting pulls seen in the registry
 * agent's event log. The daily grain is what the pull chart reads; keeping raw
 * events would grow without bound for nothing the UI shows.
 */
@Entity('docker_pull_stats')
@Index(['repositoryId', 'tag', 'date'], { unique: true })
export class DockerPullStatEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  repositoryId!: string;

  @Column()
  tag!: string;

  /** Calendar day in UTC, `YYYY-MM-DD`. */
  @Column()
  date!: string;

  @Column({ type: 'int', default: 0 })
  pulls!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
