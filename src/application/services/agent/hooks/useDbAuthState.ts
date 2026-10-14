import { In, Repository } from 'typeorm';

import type {
  AuthenticationState,
  AuthenticationCreds,
} from '@whiskeysockets/baileys' with {
  'resolution-mode': 'import',
};

import { WhatsappAuthCredential } from 'src/domain/entities/agent/WhatsappAuthCredential';
import { WhatsappAuthKey } from 'src/domain/entities/agent/WhatsappAuthKey';

export async function useDbAuthState(
  sessionId: string,
  credentialRepo: Repository<WhatsappAuthCredential>,
  keyRepo: Repository<WhatsappAuthKey>,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  flush: () => Promise<void>;
}> {
  // Baileys is ESM, while the NestJS project is CommonJS.
  // Therefore runtime values must be loaded dynamically.
  const {
    initAuthCreds,
    BufferJSON,
    proto,
  } = await import('@whiskeysockets/baileys');

  const existingCredRow =
    await credentialRepo.findOne({
      where: {
        sessionId,
      },
    });

  const creds: AuthenticationCreds =
    existingCredRow
      ? JSON.parse(
          existingCredRow.credsJson,
          BufferJSON.reviver,
        )
      : initAuthCreds();

  // Baileys doesn't await saveCreds / keys.set. All writes go through one
  // chain so they stay ordered, and flush() lets callers wait for them
  // before reconnecting or shutting down -- otherwise a half-written session
  // was left in the database.
  let pending: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = pending.then(task);
    pending = run.catch(() => undefined);
    return run;
  };

  const saveCreds = (): Promise<void> =>
    enqueue(async () => {
      const credsJson = JSON.stringify(
        creds,
        BufferJSON.replacer,
      );

      await credentialRepo.upsert(
        {
          sessionId,
          credsJson,
        },
        ['sessionId'],
      );
    });

  const state: AuthenticationState = {
    creds,

    keys: {
      get: async (
        type: string,
        ids: string[],
      ) => {
        const result: Record<string, any> = {};

        if (ids.length === 0) {
          return result;
        }

        const rows = await keyRepo.find({
          where: {
            sessionId,
            keyType: type,
            keyId: In(ids),
          },
        });

        for (const row of rows) {
          let value = JSON.parse(
            row.valueJson,
            BufferJSON.reviver,
          );

          // Same as useMultiFileAuthState -- without this, app-state sync
          // broke after a restart.
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }

          result[row.keyId] = value;
        }

        return result;
      },

      // Transaction: if the process stops mid-write, we don't keep half of
      // the keys.
      set: (
        data: Record<string, Record<string, any>>,
      ) =>
        enqueue(() =>
          keyRepo.manager.transaction(async (manager) => {
            const repo = manager.getRepository(WhatsappAuthKey);

            for (const keyType of Object.keys(data)) {
              const idMap = data[keyType];

              for (const keyId of Object.keys(idMap)) {
                const value = idMap[keyId];

                if (
                  value === null ||
                  value === undefined
                ) {
                  await repo.delete({
                    sessionId,
                    keyType,
                    keyId,
                  });

                  continue;
                }

                const valueJson = JSON.stringify(
                  value,
                  BufferJSON.replacer,
                );

                await repo.upsert(
                  {
                    sessionId,
                    keyType,
                    keyId,
                    valueJson,
                  },
                  [
                    'sessionId',
                    'keyType',
                    'keyId',
                  ],
                );
              }
            }
          }),
        ),
    } as AuthenticationState['keys'],
  };

  return {
    state,
    saveCreds,
    flush: () => pending,
  };
}
