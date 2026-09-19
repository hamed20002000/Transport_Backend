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
}> {
  // Baileys is ESM, while the NestJS project is CommonJS.
  // Therefore runtime values must be loaded dynamically.
  const {
    initAuthCreds,
    BufferJSON,
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

  const saveCreds = async (): Promise<void> => {
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
  };

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
          result[row.keyId] = JSON.parse(
            row.valueJson,
            BufferJSON.reviver,
          );
        }

        return result;
      },

      set: async (
        data: Record<string, Record<string, any>>,
      ) => {
        for (const keyType of Object.keys(data)) {
          const idMap = data[keyType];

          for (const keyId of Object.keys(idMap)) {
            const value = idMap[keyId];

            if (
              value === null ||
              value === undefined
            ) {
              await keyRepo.delete({
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

            await keyRepo.upsert(
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
      },
    } as AuthenticationState['keys'],
  };

  return {
    state,
    saveCreds,
  };
}