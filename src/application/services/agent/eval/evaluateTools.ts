/**
 * ارزیابی گام اول و دوم agent با همان سرویس‌های واقعی (نه شبیه‌سازی):
 *   گام ۱: CondinateService دو domain و ابزارهای آن‌ها را کاندید می‌کند
 *   گام ۲: AgentToolsService.extractSelectedTool (LLM) یک ابزار را انتخاب می‌کند
 *
 *   npm run agent:eval-tools
 *   npm run agent:eval-tools -- --prompts path/to/prompts.json --min-accuracy 0.9
 *
 * پیش‌نیاز: npm run agent:seed (بردارها در دیتابیس) و Ollama در حال اجرا.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { typeOrmConfig } from 'src/infrastructure/database/typeorm-cli.config';
import { ToolRegister } from '../toolRegister';
import { AgentToolsService } from '../services/agentTools.service';
import { CondinateService } from '../services/condinate.service';
import { TOOL_DOCS_PATH } from '../services/embedding.service';
import { ToolSeedDoc } from '../domainSeeding';

interface ToolPrompt {
  text: string;
  expect: string;
  role: string;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  config();
  const promptsPath =
    arg('prompts') ?? join(process.cwd(), 'src/application/services/agent/eval/tool-eval-prompts.json');
  const minAccuracy = Number(arg('min-accuracy') ?? 1);
  const prompts = JSON.parse(readFileSync(resolve(promptsPath), 'utf8')) as ToolPrompt[];
  const domainOf = new Map(
    (JSON.parse(readFileSync(TOOL_DOCS_PATH, 'utf8')) as ToolSeedDoc[]).map((t) => [t.tool_name, t.domain_name]),
  );

  const dataSource = new DataSource({
    ...(typeOrmConfig(new ConfigService()) as DataSourceOptions),
    entities: [],
    migrations: [],
    logging: false,
  });
  await dataSource.initialize();
  const register = new ToolRegister();
  const condinate = new CondinateService(register, dataSource);
  const agentTools = new AgentToolsService(register, dataSource);

  let domainHit = 0;
  let candidateHit = 0;
  let correct = 0;
  const times: number[] = [];
  try {
    for (const p of prompts) {
      const started = Date.now();
      const domains = await condinate.getCondinateDomainForRunPrompt(p.text, null, [p.role]);
      const candidates = await condinate.getCondinateToolsFromDomains(p.text, domains);
      const selected = candidates.length ? await agentTools.extractSelectedTool(p.text, candidates, '') : '';
      times.push(Date.now() - started);

      const inDomains = domains.includes(domainOf.get(p.expect) ?? '');
      const inCandidates = candidates.includes(p.expect);
      domainHit += Number(inDomains);
      candidateHit += Number(inCandidates);
      correct += Number(selected === p.expect);

      const status = selected === p.expect ? 'OK  ' : !inCandidates ? 'MISS' : 'FAIL';
      console.log(
        `${status} expect=${p.expect.padEnd(34)} got=${selected.padEnd(34)} domains=[${domains.join(', ')}]\n     ${p.text}`,
      );
    }
  } finally {
    await dataSource.destroy();
  }

  const n = prompts.length;
  times.sort((a, b) => a - b);
  console.log('');
  console.log(`step 1: expected domain in selected domains : ${domainHit}/${n}`);
  console.log(`step 1: expected tool among candidates       : ${candidateHit}/${n}`);
  console.log(`step 2: LLM picked the expected tool         : ${correct}/${n} (${((correct / n) * 100).toFixed(1)}%)`);
  console.log(
    `latency (steps 1+2) median ${(times[Math.floor(n / 2)] / 1000).toFixed(2)}s, max ${(times[n - 1] / 1000).toFixed(2)}s`,
  );
  console.log(
    'MISS = the right tool never reached the LLM (step 1); FAIL = it did, and the LLM chose another (step 2).',
  );
  if (correct / n < minAccuracy) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
