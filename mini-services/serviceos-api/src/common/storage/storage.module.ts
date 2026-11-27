import { Global, Module } from '@nestjs/common';
import { EnvToken, type Env } from '../config/env';
import { LocalDiskStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import type { StoragePort } from './storage.port';
import {
  ClamAvScanner,
  SignatureMalwareScanner,
  type MalwareScannerPort,
} from './malware-scanner';

/** DI tokens for the selected storage adapter and malware scanner. */
export const STORAGE_PORT = Symbol('STORAGE_PORT');
export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');

/**
 * Storage composition root (ADR-010, audit SEC-06/INFRA-01): selects the
 * adapter by STORAGE_DRIVER and the scanner by MALWARE_SCANNER. The factory
 * runs at boot — a misconfigured production environment fails fast in
 * loadEnv() before any request is served.
 */
@Global()
@Module({
  providers: [
    LocalDiskStorageAdapter,
    S3StorageAdapter,
    SignatureMalwareScanner,
    ClamAvScanner,
    {
      provide: STORAGE_PORT,
      useFactory: (env: Env, local: LocalDiskStorageAdapter, s3: S3StorageAdapter): StoragePort =>
        env.storageDriver === 's3' ? s3 : local,
      inject: [EnvToken, LocalDiskStorageAdapter, S3StorageAdapter],
    },
    {
      provide: MALWARE_SCANNER,
      useFactory: (env: Env, signature: SignatureMalwareScanner, clamav: ClamAvScanner): MalwareScannerPort => {
        if (env.malwareScanner === 'clamav') return clamav;
        if (env.malwareScanner === 'signature') return signature;
        // 'disabled' is dev/test only — loadEnv() rejects it in production.
        return {
          async scan() {
            return { status: 'clean' as const };
          },
        };
      },
      inject: [EnvToken, SignatureMalwareScanner, ClamAvScanner],
    },
  ],
  exports: [STORAGE_PORT, MALWARE_SCANNER, LocalDiskStorageAdapter],
})
export class StorageModule {}
