import { Injectable } from '@nestjs/common';
import { llmChat, llmJson } from 'src/services/common/llmClient';
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import tables from 'src/agent/tables.json';
import schema from 'src/application/services/agent/schema.json';



@Injectable()
export class AgentSqlService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
    ) {

    }

    async runPrompt(prompt: string, systemContent: string): Promise<string> {
        return llmChat({
            messages: [
                {
                    role: 'system',
                    content: systemContent
                },
                {
                    role: "user",
                    content: prompt
                }],
            options: {
                temperature: 0,
                top_p: 0.9,
                repeat_penalty: 1.1
            },
            format: {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string"
                    },
                    "error": {
                        "type": "string"
                    },
                    "fields": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    }
                }
            }
        });

    }
    async executeQuery(text: string): Promise<void> {

        this.dataSource.query(text);
    }
     async extractSchema(prompt: string): Promise<string> {
    
    
    
            const systemRules = `You are a database table selection agent.
    
    Your ONLY task is to select required database tables.
    
    Rules:
    - Use ONLY tables from the provided catalog.
    - Never explain your answer.
    - Never generate SQL.
    - Never show reasoning.
    - Return ONLY JSON.
    - The response must start with { and end with }.
    
    Output format:
    
    {
      "tables": ["TableName"]
    }`
    
    
            prompt = `
    Table catalog:
    
    ${JSON.stringify(tables, null, 2)}
    
    Request:
    ${prompt}`;
    
    
    
            const parsed = await llmJson<{ tables?: string[] }>({
                messages: [
                    {
                        role: 'system',
                        content: systemRules
                    },
                    {
                        role: "user",
                        content: prompt
                    }],
                format: {
                    type: "object",
                    properties: {
                        tables: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        }
                    },
                    required: ["tables"]
                }
            });
            const tablesResponse = parsed?.tables || [];
            const selectedTables = [];
            for (const tableName of tablesResponse) {
                const table = schema.tables.find(t => t.name === tableName);
                if (table) {
                    selectedTables.push(table);
                }
            }
    
            return JSON.stringify(selectedTables, null, 2);
        }
  
}