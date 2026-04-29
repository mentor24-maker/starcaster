require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MAX_STEPS = 40;

const tools = [{
    functionDeclarations: [
        {
            name: 'read_directory',
            description: 'List the contents of a directory to see files and folders.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    dirPath: { type: 'STRING', description: 'Relative path to directory to read, e.g. "." or "public/js"' }
                },
                required: ['dirPath']
            }
        },
        {
            name: 'search_files',
            description: 'Search for a text pattern across all files in the repository using grep.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    query: { type: 'STRING', description: 'The text string to search for' }
                },
                required: ['query']
            }
        },
        {
            name: 'read_file',
            description: 'Read the entire contents of a file.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    filePath: { type: 'STRING', description: 'Relative path to the file' }
                },
                required: ['filePath']
            }
        },
        {
            name: 'write_file',
            description: 'Create a new file or completely overwrite an existing file with new content.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    filePath: { type: 'STRING', description: 'Relative path to the file' },
                    content: { type: 'STRING', description: 'The complete new content of the file' }
                },
                required: ['filePath', 'content']
            }
        },
        {
            name: 'replace_file_content',
            description: 'Replace a specific snippet of text in a file. The target text must match EXACTLY, including whitespace.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    filePath: { type: 'STRING', description: 'Relative path to the file' },
                    target: { type: 'STRING', description: 'The exact text to find and replace' },
                    replacement: { type: 'STRING', description: 'The text to replace it with' }
                },
                required: ['filePath', 'target', 'replacement']
            }
        },
        {
            name: 'task_complete',
            description: 'Call this function when you have successfully completed the task and verified your changes.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    summary: { type: 'STRING', description: 'A short summary of what you changed' }
                },
                required: ['summary']
            }
        }
    ]
}];

async function executeTask(taskId, taskTitle, taskDescription, repoPath) {
    console.log(`\nInitializing Gemini Brain for task: ${taskId}`);
    
    let isComplete = false;
    let stepCount = 0;
    
    // Helper function to resolve paths safely within sandbox
    const resolvePath = (p) => {
        // Prevent directory traversal attacks escaping the repoPath
        const resolved = path.resolve(repoPath, p);
        if (!resolved.startsWith(repoPath)) {
            throw new Error(`Security Violation: Attempted to access path outside sandbox: ${p}`);
        }
        return resolved;
    };

    const systemInstruction = `You are Archie, an autonomous AI software engineer. 
You are currently operating in an isolated git sandbox.
Your workspace directory is the root of the repository.

Task Details:
Title: ${taskTitle}
Description: ${taskDescription}

Instructions:
1. Use your tools to explore the codebase, read files, and understand the architecture.
2. Use write_file or replace_file_content to implement the required changes.
3. You must work efficiently. You have a maximum of ${MAX_STEPS} steps to complete this task.
4. When you are finished, you MUST call the task_complete tool to signal you are done.

Remember: DO NOT output markdown code blocks containing the entire file if you intend to write it. You MUST use the tool calls to modify files.`;

    const chat = ai.chats.create({
        model: 'gemini-2.5-pro',
        config: {
            systemInstruction: systemInstruction,
            tools: tools,
            temperature: 0.1
        }
    });

    console.log('Sending initial prompt to Gemini...');
    let response = await chat.sendMessage({ message: `I am ready. Begin the task. Use your tools.` });

    while (!isComplete && stepCount < MAX_STEPS) {
        stepCount++;
        console.log(`\n--- Step ${stepCount}/${MAX_STEPS} ---`);
        
        if (!response.functionCalls || response.functionCalls.length === 0) {
            console.log('Gemini responded with text but no tool calls. Prompting to continue...');
            response = await chat.sendMessage({ message: 'Please continue using your tools to complete the task, or call task_complete if finished.' });
            continue;
        }

        const functionResponses = [];

        for (const call of response.functionCalls) {
            const name = call.name;
            const args = call.args;
            console.log(`Tool Call: ${name}(${JSON.stringify(args).substring(0, 100)}...)`);
            
            let result = {};
            
            try {
                if (name === 'read_directory') {
                    const fullPath = resolvePath(args.dirPath);
                    if (!fs.existsSync(fullPath)) throw new Error(`Directory not found: ${args.dirPath}`);
                    const items = fs.readdirSync(fullPath, { withFileTypes: true });
                    const files = items.filter(i => !i.isDirectory()).map(i => i.name);
                    const dirs = items.filter(i => i.isDirectory()).map(i => i.name);
                    result = { files, directories: dirs };
                }
                else if (name === 'search_files') {
                    const { execSync } = require('child_process');
                    try {
                        const out = execSync(`grep -rnI "${args.query.replace(/"/g, '\\"')}" . || true`, { cwd: repoPath, encoding: 'utf8' });
                        result = { matches: out.substring(0, 5000) }; // Cap output to avoid huge payloads
                    } catch(e) {
                        result = { error: 'Search failed or no matches found' };
                    }
                } 
                else if (name === 'read_file') {
                    const fullPath = resolvePath(args.filePath);
                    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${args.filePath}`);
                    const content = fs.readFileSync(fullPath, 'utf8');
                    result = { content };
                }
                else if (name === 'write_file') {
                    const fullPath = resolvePath(args.filePath);
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, args.content, 'utf8');
                    result = { success: true, message: `File ${args.filePath} written successfully.` };
                }
                else if (name === 'replace_file_content') {
                    const fullPath = resolvePath(args.filePath);
                    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${args.filePath}`);
                    let content = fs.readFileSync(fullPath, 'utf8');
                    if (!content.includes(args.target)) {
                        throw new Error(`Target text not found exactly in file. Please read the file again and ensure exact matching whitespace.`);
                    }
                    content = content.replace(args.target, args.replacement);
                    fs.writeFileSync(fullPath, content, 'utf8');
                    result = { success: true, message: `Replaced content in ${args.filePath}.` };
                }
                else if (name === 'task_complete') {
                    console.log(`\n✅ Task Complete! Summary: ${args.summary}`);
                    isComplete = true;
                    result = { success: true };
                }
            } catch (err) {
                console.error(`Tool Execution Error: ${err.message}`);
                result = { error: err.message };
            }
            
            functionResponses.push({
                functionResponse: {
                    name: name,
                    response: result
                }
            });
        }
        
        if (isComplete) break;

        // Send function results back to Gemini
        response = await chat.sendMessage({ message: functionResponses });
    }
    
    if (!isComplete) {
        console.warn(`\n⚠️ Task reached maximum steps (${MAX_STEPS}) without calling task_complete.`);
        // Force write a summary file so we have a commit
        const fallbackPath = path.join(repoPath, 'DAEMON_STATUS.md');
        fs.writeFileSync(fallbackPath, `# Task ${taskId}\nFailed to complete within ${MAX_STEPS} steps.`);
    }
    
    console.log(`Task execution finished.`);
}

module.exports = {
    executeTask
};
