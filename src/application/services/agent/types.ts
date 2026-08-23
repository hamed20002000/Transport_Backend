
export type Property = {
    type: string
    description: string
}

export type Parameters = {
    type: string
    properties: Record<string, Property>
    required: string[]
}


export type Function = {
    name: string,
    description: string
    parameters: Parameters
}

export type Tool = {
    type: string
    function: Function
}

export const Tools :Tool[]=[{

    type: "function",
    function: {
        name: "create-category",
        description: "register new category in database",
        parameters: {
            type:"object",
            properties:{
                "name":{
                    type:"string",
                    description:"name of Category"
                },
                "code":{
                    type:"string",
                    description:'code for detecting category'
                },
                "parentId":{
                    type:"string",
                    description:"id of parent"
                }
            },
            
         required:["name","code"]
        },
    },

}]


export type Message={
	role:string,
	content:string
}

export type ChatRequest={
	model:string,
	messages:Message[],
	stream:boolean,
    tools?:Tool[],
     options?: {
                    temperature: number,
                    top_p: number,
                    repeat_penalty: number
                }
}

export type ChatResponse={
	message :{
		content :string,
	}
}

export type CondinateToolsTyes={
    ToolName:string,
    Embedding:number[]
}

export type ExtracteToolsType={
       functionName: string,
       confidence: number,
       parameters:any
}

export type ToolHandlerType={
    functionName:string,
    handler:(params: any) => Promise<any>;
}


export type ContextInfo={
    operation:string;
    result:Record<string,string>;
    parameters:Record<string,string>;
    status:"success"|"fault",
    domain?:string
}

export type RequestResult={
      toolName:string;
      continuePrompt:string;
}
export type FunctionCallResultType={
    result:"error"|"success"|"cancelled",
    message:string,
    continuePrompt: string | undefined,
    toolName: string,
    lastsegment:boolean,
    list:any[]
}
