import { DataSource } from 'typeorm';

import { EmbeddingDomainTool } from './types';

export interface DomainSeedResult {
  upserted: string[];
  /** domainهایی که دیگر در فایل نیستند و پاک شدند (فقط وقتی removeMissing) */
  removed: string[];
}

/**
 * بردار domainها را می‌سازد و در "ToolDomain" می‌نویسد. اول همه‌ی embeddingها
 * گرفته می‌شود و بعد همه در یک transaction نوشته می‌شوند؛ اگر OpenAI وسط کار
 * خطا بدهد جدول دست نمی‌خورد. اجرای دوباره (بعد از ویرایش توضیح‌ها) همان
 * ردیف‌ها را به‌روز می‌کند.
 *
 * removeMissing: فایل منبع کامل است؛ domainهایی که در آن نیستند پاک می‌شوند.
 */
export async function seedToolDomains(
  dataSource: DataSource,
  docs: EmbeddingDomainTool[],
  embed: (text: string) => Promise<number[]>,
  options: { removeMissing: boolean },
): Promise<DomainSeedResult> {
  const withoutRoles = docs.filter((doc) => !Array.isArray(doc.roles) || doc.roles.length === 0);
  if (withoutRoles.length) {
    throw new Error(`Domains without roles: ${withoutRoles.map((doc) => doc.domain_name).join(', ')}`);
  }
  const names = docs.map((doc) => doc.domain_name);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  if (duplicates.length) throw new Error(`Duplicate domains: ${[...new Set(duplicates)].join(', ')}`);

  const vectors: number[][] = [];
  for (const doc of docs) vectors.push(await embed(doc.embedding_text));

  return dataSource.transaction(async (manager) => {
    for (const [i, doc] of docs.entries()) {
      await manager.query(
        `INSERT INTO "ToolDomain" ("DomainName", "DisplayText", "Embedding", "Roles")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("DomainName") DO UPDATE
           SET "DisplayText" = EXCLUDED."DisplayText",
               "Embedding" = EXCLUDED."Embedding",
               "Roles" = EXCLUDED."Roles";`,
        [doc.domain_name, doc.embedding_text, `[${vectors[i].join(',')}]`, doc.roles],
      );
    }

    let removed: string[] = [];
    if (options.removeMissing) {
      const result = await manager.query(
        `DELETE FROM "ToolDomain" WHERE NOT ("DomainName" = ANY($1::text[])) RETURNING "DomainName";`,
        [names],
      );
      // درایور postgres برای DELETE مقدار [rows, rowCount] برمی‌گرداند
      const rows: { DomainName: string }[] = Array.isArray(result[0]) ? result[0] : result;
      removed = rows.map((row) => row.DomainName);
    }

    return { upserted: names, removed };
  });
}

export interface ToolSeedDoc {
  tool_name: string;
  embedding_text: string;
  domain_name: string;
}

/**
 * بردار ابزارها را در "EmbeddingTool" می‌نویسد. ToolName در جدول یکتا نیست،
 * پس ردیف‌های همان ابزارها (یا با replaceAll کل جدول) در همان transaction پاک
 * و دوباره نوشته می‌شوند؛ اجرای دوباره تکراری نمی‌سازد. ابزاری که domainش در
 * "ToolDomain" نیست رد می‌شود، چون هیچ‌وقت کاندید نمی‌شد.
 */
export async function seedEmbeddingTools(
  dataSource: DataSource,
  docs: ToolSeedDoc[],
  embed: (text: string) => Promise<number[]>,
  options: { replaceAll: boolean },
): Promise<{ written: string[] }> {
  const names = docs.map((doc) => doc.tool_name);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  if (duplicates.length) throw new Error(`Duplicate tools: ${[...new Set(duplicates)].join(', ')}`);

  const domains: { DomainName: string }[] = await dataSource.query(`SELECT "DomainName" FROM "ToolDomain";`);
  const known = new Set(domains.map((d) => d.DomainName));
  const orphans = docs.filter((doc) => !known.has(doc.domain_name));
  if (orphans.length) {
    throw new Error(`Tools with unknown domain: ${orphans.map((d) => `${d.tool_name} (${d.domain_name})`).join(', ')}`);
  }

  const vectors: number[][] = [];
  for (const doc of docs) vectors.push(await embed(doc.embedding_text));

  return dataSource.transaction(async (manager) => {
    if (options.replaceAll) {
      await manager.query(`DELETE FROM "EmbeddingTool";`);
    } else {
      await manager.query(`DELETE FROM "EmbeddingTool" WHERE "ToolName" = ANY($1::text[]);`, [names]);
    }
    for (const [i, doc] of docs.entries()) {
      await manager.query(
        `INSERT INTO "EmbeddingTool" ("ToolName", "Document", "Embedding", "DomainName") VALUES ($1, $2, $3, $4);`,
        [doc.tool_name, doc.embedding_text, `[${vectors[i].join(',')}]`, doc.domain_name],
      );
    }
    return { written: names };
  });
}

export interface AgentSyncResult {
  domains: string[];
  removedDomains: string[];
  tools: string[];
  removedTools: string[];
}

const sameRoles = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * The files (domain_embedding_docs.json, tool_embedding_docs.json) brought to the database: only the domains and tools
 * that are new or whose text, roles or domain changed are embedded again; those gone from the files are deleted. A
 * deploy (or a dev server start) with new docs then routes to them without anyone running `npm run agent:seed`; the
 * same texts embed to the same vectors, so nothing is paid for when nothing changed. An embedding-model change keeps
 * the texts and still needs the full `npm run agent:seed`.
 */
export async function syncAgentEmbeddings(
  dataSource: DataSource,
  domains: EmbeddingDomainTool[],
  tools: ToolSeedDoc[],
  embed: (text: string) => Promise<number[]>,
): Promise<AgentSyncResult> {
  const savedDomains: Array<{ DomainName: string; DisplayText: string; Roles: string[]; hasVector: boolean }> = await dataSource.query(
    `SELECT "DomainName", "DisplayText", "Roles", "Embedding" IS NOT NULL AS "hasVector" FROM "ToolDomain";`,
  );
  const domainByName = new Map(savedDomains.map((row) => [row.DomainName, row]));
  const changedDomains = domains.filter((doc) => {
    const saved = domainByName.get(doc.domain_name);
    return !saved || !saved.hasVector || saved.DisplayText !== doc.embedding_text || !sameRoles(saved.Roles ?? [], doc.roles ?? []);
  });
  if (changedDomains.length) await seedToolDomains(dataSource, changedDomains, embed, { removeMissing: false });

  const savedTools: Array<{ ToolName: string; Document: string; DomainName: string | null; hasVector: boolean }> = await dataSource.query(
    `SELECT "ToolName", "Document", "DomainName", "Embedding" IS NOT NULL AS "hasVector" FROM "EmbeddingTool";`,
  );
  const toolRows = new Map<string, typeof savedTools>();
  for (const row of savedTools) toolRows.set(row.ToolName, [...(toolRows.get(row.ToolName) ?? []), row]);
  const changedTools = tools.filter((doc) => {
    const rows = toolRows.get(doc.tool_name) ?? [];
    // one row per tool: a duplicate is written again too
    return rows.length !== 1 || !rows[0].hasVector || rows[0].Document !== doc.embedding_text || rows[0].DomainName !== doc.domain_name;
  });
  if (changedTools.length) await seedEmbeddingTools(dataSource, changedTools, embed, { replaceAll: false });

  // gone from the files: the tools first (they point at their domain)
  const toolNames = tools.map((doc) => doc.tool_name);
  const domainNames = domains.map((doc) => doc.domain_name);
  const removedTools = [...toolRows.keys()].filter((name) => !toolNames.includes(name));
  const removedDomains = savedDomains.map((row) => row.DomainName).filter((name) => !domainNames.includes(name));
  if (removedTools.length || removedDomains.length) {
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM "EmbeddingTool" WHERE "ToolName" = ANY($1::text[]) OR "DomainName" = ANY($2::text[]);`,
        [removedTools, removedDomains],
      );
      await manager.query(`DELETE FROM "ToolDomain" WHERE "DomainName" = ANY($1::text[]);`, [removedDomains]);
    });
  }

  return {
    domains: changedDomains.map((doc) => doc.domain_name),
    removedDomains,
    tools: changedTools.map((doc) => doc.tool_name),
    removedTools,
  };
}
