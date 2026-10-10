
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
    /** فکر کردن مدل (qwen3)؛ پیش‌فرض Ollama روشن است */
    think?: boolean,
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