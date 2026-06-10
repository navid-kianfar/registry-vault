import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { RegistryCredentialEntity } from '../../settings/entities/registry-credential.entity';

const PREFIX = 'enc:v1:';

@Injectable()
export class CredentialCryptoService {
  private readonly logger = new Logger(CredentialCryptoService.name);
  private key: Buffer | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(RegistryCredentialEntity)
    private readonly credentialRepo: Repository<RegistryCredentialEntity>,
  ) {}

  /**
   * Key resolution order:
   *  1. ENCRYPTION_KEY env var (64-char hex, or any string derived via SHA-256)
   *  2. .encryption-key file next to the SQLite database — auto-generated on
   *     first use so it lives on the same persistent volume as the data it
   *     protects and survives container recreation. Postgres deployments
   *     should set ENCRYPTION_KEY explicitly.
   */
  private getKey(): Buffer {
    if (this.key) return this.key;

    const fromEnv = this.configService.get<string>('ENCRYPTION_KEY');
    if (fromEnv) {
      this.key = this.deriveKey(fromEnv);
      return this.key;
    }

    const dbPath = this.configService.get<string>(
      'DB_PATH',
      './data/registry-vault.db',
    );
    const keyFile = path.join(
      path.dirname(path.resolve(dbPath)),
      '.encryption-key',
    );

    if (fs.existsSync(keyFile)) {
      this.key = this.deriveKey(fs.readFileSync(keyFile, 'utf8').trim());
      return this.key;
    }

    const generated = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, `${generated}\n`, { mode: 0o600 });
    this.logger.log(`Generated credential encryption key at ${keyFile}`);
    this.key = Buffer.from(generated, 'hex');
    return this.key;
  }

  private deriveKey(value: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
    return crypto.createHash('sha256').update(value, 'utf8').digest();
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getKey(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  /** Decrypt a stored value. Legacy plaintext (no prefix) is returned as-is. */
  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    try {
      const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getKey(),
        Buffer.from(iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new UnprocessableEntityException(
        'Stored registry credential could not be decrypted — the encryption key has changed. Re-enter the secret in Settings → Credentials.',
      );
    }
  }

  /**
   * Prepare a fetched credential for use against a registry: returns it with
   * encryptedPassword holding the plaintext secret (in memory only). Legacy
   * plaintext rows are transparently re-encrypted at rest on first use.
   */
  async prepareForUse(
    credential: RegistryCredentialEntity | null,
  ): Promise<RegistryCredentialEntity | null> {
    if (!credential || !credential.encryptedPassword) return credential;

    if (!this.isEncrypted(credential.encryptedPassword)) {
      await this.migrateAtRest(credential);
      return credential;
    }

    credential.encryptedPassword = this.decrypt(credential.encryptedPassword);
    return credential;
  }

  /** Re-encrypt a legacy plaintext row at rest; the entity keeps the plaintext in memory. */
  async migrateAtRest(entity: RegistryCredentialEntity): Promise<void> {
    if (entity.encryptedPassword && !this.isEncrypted(entity.encryptedPassword)) {
      await this.credentialRepo.update(entity.id, {
        encryptedPassword: this.encrypt(entity.encryptedPassword),
      });
      this.logger.log(
        `Migrated credential ${entity.id} (${entity.registryName}) to encrypted storage`,
      );
    }
  }
}
