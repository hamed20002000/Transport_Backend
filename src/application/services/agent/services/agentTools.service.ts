import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '../../base.service';
import { Roles } from 'src/domain/entities/Roles';
import { RoleRepository } from 'src/infrastructure/repositories/user/role.repository';
import { RoleMenuOperations } from 'src/domain/entities/RoleMenuOperations';
import { RoleMenuOperationRepository } from 'src/infrastructure/repositories/user/role-menu-operation.repository';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChatRequest, Tool } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import tables from 'src/agent/tables.json';
import schema from 'src/application/services/agent/schema.json';
import { extractRelations } from '../extractRelations';
import tools from 'src/application/services/agent/localFiles/tools.json';
import { CondinateToolsTyes, ExtracteToolsType } from '../types';
import { ToolRegister } from '../toolRegister';
import { RequestResult } from '../types';


@Injectable()
export class AgentToolsService {
    constructor(
        private readonly toolRegister: ToolRegister,
        @InjectDataSource() private readonly dataSource: DataSource
    ) {

    }

    async extractSelectedTool(prompt: string, condinateTools: string[], history: string): Promise<string> {
    const systemRules = `
You are a tool selection agent.

IMPORTANT CONTEXT: The message you receive has already been segmented
upstream into a single, isolated operation request. It represents EXACTLY
ONE distinct operation -- never more than one. Your only job is to select
the ONE correct tool for it.

Analyze the current user prompt together with the conversation history
and the available candidate tools and their schemas.

Your task is to:

1. Identify the single operation requested by the current user prompt.
2. Select exactly one tool that matches this operation.
3. Return that tool's name only.
4. Return valid JSON only.

Tool selection rules:

- You may select the tool ONLY from the provided candidate tools.
- The functionName in the output MUST exactly match the name of one of
  the provided candidate tools.
- Never invent a new tool name.
- Never generate a tool name based on the user's wording.
- Never rename, modify, combine, or infer a tool name.
- If no candidate tool genuinely matches the requested operation, return
  the closest matching tool from the candidates -- do not return an empty
  or fabricated value.

- The current user prompt is the primary source for determining the
  requested operation.
- Select the tool according to semantic intent.
- Do not select a tool merely because of keyword similarity.

- Use conversation history only to understand the intent of the current
  request (e.g. resolving what entity "it" or an implicit subject refers
  to). Do not treat previous operations as the current operation.
- Do not use previous parameters to make the tool selection unless they
  are necessary to understand what operation is being requested.

- Do not extract or return parameters.

Conversation history:
${history.length === 0 ? "empty" : history}

Tool schemas:
${JSON.stringify(
        tools.tools.filter((item) => {
            if (condinateTools.find((condic) => condic == item.name) != undefined) {
                return item;
            }
        })
    )}

Output format:

{
  "functionName": "tool_name"
}

Return JSON only.
`;

     const ollamareq: ChatRequest = {
        model: "qwen3:8b",
        messages: [
            {
                role: 'system',
                content: systemRules
            },
            {
                role: "user",
                content: prompt
            }],
        stream: false,
    }

    const resp = await axios.post(
        "http://localhost:11434/api/chat",
        JSON.stringify({
            ...ollamareq,
            format: {
                type: "object",
                properties: {
                    functionName: {
                        type: "string"
                    }
                },
                required: ["functionName"]
            }
        }),
        {
            headers: {
                "Content-Type": "application/json",
            },
        },
    );

    const result = JSON.parse(resp.data.message.content);

    return result.functionName;


    }

    async extractTools(prompt: string, condinateTool: string, history: string): Promise<ExtracteToolsType> {

        var selectedTool;
        const systemRules = `
You are a tool selection and parameter extraction agent.
Analyze the current user prompt together with the conversation history and
the provided candidate tools.

Your tasks:


1. Select exactly one function from the provided tools.
2. Extract the required parameters for that function.
3. Return valid JSON only.




Tool selection rules:


- Choose the function that matches the user's intent.
- Do not select multiple functions.

Parameter extraction rules:



  - Extract only the actual entity value required by the function.
- Remove surrounding words from the user's sentence.
- Return the value as it should exist in the database.
- Keep the original language and writing system of the entity.
- Never translate parameter values.
- Never transliterate parameter values.
- Never convert one language into another language.
- Never replace a value with a synonym.
- Never invent a new value.
- Never change the meaning of the value.
- Do not correct spelling.

Important:
- If the user adds language-specific grammar around an entity, remove only that grammar part.
- Keep the original entity unchanged.
- The output should represent the same entity mentioned by the user.

Examples of behavior:
- "user's entity" -> return only the entity
- "entity with grammatical changes" -> return the original entity without those changes

Parameter values must not be translated or rewritten.

Parameter extraction for multiple selected tools:

Each selected tool has its own parameter extraction task.

Extract the parameters for each selected tool independently from the current
prompt.

When the current prompt contains multiple operations, determine which part of
the prompt belongs to each selected tool and extract parameters only from that
part.

Do not reuse a parameter extracted for one tool as the parameter of another
tool.

A parameter value belonging to one operation must not automatically be applied
to another operation.

If different operations contain different entity values, preserve the entity
value associated with each operation.

Use the linguistic structure and meaning of the current prompt to determine
which entity belongs to which tool.

Do not use a parameter from one operation simply because it appeared earlier in
the prompt.

Explicit parameter values in the current prompt must be preserved exactly as
provided by the user.

Conversation history may be used only according to the history rules below.
History must not override an explicit parameter belonging to the current
operation.

History-based parameter extraction:

- When necessary, obtain parameter values from the conversation history.
- The current prompt and the conversation history must be interpreted
  together when extracting parameters.
- A parameter does not have to be explicitly present in the current prompt.
  If its value was established by a relevant previous operation, use that
  value from the history.
- Use history only when it provides information necessary to understand or
  complete the current request.
- Do not copy parameters from previous interactions unless they are relevant
  to the current request.
- When a parameter is obtained from the history, use its exact value as stored
  in the history.
- Never translate, transliterate, paraphrase, normalize, correct, or replace
  a parameter value obtained from the history.
- The history may provide entity values, identifiers, names, or other
  parameter values required by the selected tool.
- If the required parameter value exists in the relevant history, extract it
  from there even when the current prompt does not explicitly contain the
  value.
- If the required parameter value cannot be determined from the current
  prompt or relevant history, do not invent or guess it.

    History usage rules:

The current user prompt is the primary source for determining the current
operation and its explicitly provided parameters.

Before using the history, determine whether the current prompt can be fully
understood and its required parameters can be extracted without information
from previous interactions.

Use the history only when information from previous interactions is necessary
to understand the meaning of the current prompt or to complete a required
parameter that the current prompt depends on.

Do not use the history when the current prompt independently specifies the
operation and all required information.

Do not use the history merely because the same entity, name, value, or type of
operation appeared previously.

Do not use the result or state of a previous operation to reinterpret the
operation requested by the current prompt.

If the current prompt expresses a new operation independently, treat it as a
new operation even when an identical or similar operation exists in the
history.

If the current prompt is incomplete or semantically dependent on information
established previously, use the relevant history to resolve that dependency.

Only use the minimum amount of history necessary to resolve the current
request.

Ignore historical information that is not required for the current request.

When history is used, use it to provide missing context or parameters, not to
replace the intent expressed by the current prompt.


Conversation history:
${history.length == 0 ? "empty" : history}

Available tools:
${condinateTool}

Tool schemas:
${JSON.stringify(
            tools.tools.filter((item) => {
                if (item.name == condinateTool) {
                    selectedTool = item;
                    return item;
                }
            })
        )}
`;

        const ollamareq: ChatRequest = {
            model: "qwen3:8b",
            messages: [
                {
                    role: 'system',
                    content: systemRules
                },
                {
                    role: "user",
                    content: prompt
                }],
            stream: false,
        }
        const resp = await axios.post(
            "http://localhost:11434/api/chat",
            JSON.stringify({
                ...ollamareq,
                format: {
                    type: "object",
                    properties: {
                        functionName: {
                            type: "string"
                        },
                        confidence: {
                            type: "number"
                        },
                        parameters: selectedTool.parameters
                    },
                    required: ["functionName", "parameters", "confidence"]
                }

            }),

            {
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );
        const result: ExtracteToolsType = {
            functionName: JSON.parse(resp.data.message.content).functionName,
            parameters: JSON.parse(resp.data.message.content).parameters,
            confidence: JSON.parse(resp.data.message.content).confidence
        }
        return result



    }


    async executeTool(toolName: string, parameter: any, req: any): Promise<RequestResult> {

         try{

                 const currentDomain: { DomainName: string }[] = await this.dataSource.query(
            `SELECT "DomainName" FROM "EmbeddingTool" WHERE "ToolName" = $1 LIMIT 1;`,
            [toolName]
        );

            
              const result = await this.toolRegister.execute(toolName, { ...parameter, req,toolDomain:currentDomain.length > 0 ? currentDomain[0].DomainName : null });

              return result;


         }
         catch(error:any){
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);

         }






    }
}