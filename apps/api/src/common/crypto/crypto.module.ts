import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RegistryCredentialEntity } from '../../settings/entities/registry-credential.entity';
import { CredentialCryptoService } from './credential-crypto.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RegistryCredentialEntity])],
  providers: [CredentialCryptoService],
  exports: [CredentialCryptoService],
})
export class CryptoModule {}
