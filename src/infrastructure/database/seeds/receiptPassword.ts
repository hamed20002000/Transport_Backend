/**
 * The argon2 hash of the password that unlocks payment receipt photos in the admin panel (ReceiptAccessService):
 *
 *   npm run receipt-password
 *
 * asks for the password without echoing it and prints the line to put in the server's .env. Only the hash is
 * stored; changing the password = running this again and replacing the line (then restart the server).
 */
import * as argon2 from 'argon2';
import { createInterface } from 'readline';

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // keep what is typed off the screen
  (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text) => {
    if (text.includes(question)) process.stdout.write(text);
  };
  return new Promise((done) => rl.question(question, (answer) => {
    rl.close();
    process.stdout.write('\n');
    done(answer);
  }));
}

async function main(): Promise<void> {
  const password = await ask('رمز مشاهده‌ی رسیدها (حداقل ۱۰ نویسه): ');
  if (Array.from(password).length < 10) throw new Error('رمز باید حداقل ۱۰ نویسه باشد.');
  if ((await ask('تکرار رمز: ')) !== password) throw new Error('دو رمز یکی نیستند.');
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  console.log(`\nاین خط را در .env سرور بگذارید و سرور را ری‌استارت کنید:\n\nRECEIPT_VIEW_PASSWORD_HASH='${hash}'\n`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
