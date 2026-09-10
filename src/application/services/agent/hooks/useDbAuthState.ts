import { In, Repository } from 'typeorm';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import type { AuthenticationState, AuthenticationCreds } from '@whiskeysockets/baileys';
import { WhatsappAuthCredential } from '../entities/WhatsappAuthCredential';
import { WhatsappAuthKey } from '../entities/WhatsappAuthKey';


/**
* A version of useMultiFileAuthState that uses PostgreSQL instead of the file system. 
* This is necessary to prevent credentials from being lost whenever the server restarts—
* otherwise, you would have to scan the QR code again after every deployment. 
*/

export async function useDbAuthState(
  sessionId: string,
  credentialRepo: Repository<WhatsappAuthCredential>,
  keyRepo: Repository<WhatsappAuthKey>,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {

  //Load existing credentials from the database
  const existingCredRow = await credentialRepo.findOne({ where: { sessionId } });

  // If no existing credentials are found, initialize new credentials
  const creds: AuthenticationCreds = existingCredRow
    ? JSON.parse(existingCredRow.credsJson, BufferJSON.reviver)
    : initAuthCreds();
  
    // Save the credentials to the database if they are new
  const saveCreds = async () => {
    const credsJson = JSON.stringify(creds, BufferJSON.replacer);
    await credentialRepo.upsert({ sessionId, credsJson }, ['sessionId']);
  };

  // Create the authentication state object with methods to get and set keys in the database
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const result: Record<string, any> = {};
        if (ids.length === 0) return result;

        const rows = await keyRepo.find({
          where: { sessionId, keyType: type, keyId: In(ids) },
        });

        for (const row of rows) {
          result[row.keyId] = JSON.parse(row.valueJson, BufferJSON.reviver);
        }
        return result;
      },
      set: async (data: Record<string, Record<string, any>>) => {
        for (const keyType of Object.keys(data)) {
          const idMap = data[keyType];
          for (const keyId of Object.keys(idMap)) {
            const value = idMap[keyId];
            if (value === null || value === undefined) {
              await keyRepo.delete({ sessionId, keyType, keyId });
            } else {
              const valueJson = JSON.stringify(value, BufferJSON.replacer);
              await keyRepo.upsert(
                { sessionId, keyType, keyId, valueJson },
                ['sessionId', 'keyType', 'keyId'],
              );
            }
          }
        }
      },
    } as any,
  };

  return { state, saveCreds };
}