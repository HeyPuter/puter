import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { CommandService } from './CommandService';

describe('CommandService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            commands: CommandService,
        },
        initLevelString: 'init',
    });

    const commandService = testKernel.services!.get('commands') as CommandService;

    it('should be instantiated', () => {
        expect(commandService).toBeInstanceOf(CommandService);
    });

    it('should have help command registered by default', () => {
        expect(commandService.commandNames).toContain('help');
    });

    it('should register commands', () => {
        commandService.registerCommands('test-service', [
            {
                id: 'test-cmd',
                description: 'A test command',
                handler: async () => {},
            },
        ]);
        expect(commandService.commandNames).toContain('test-service:test-cmd');
    });

    it('should execute registered commands', async () => {
        let executed = false;
        commandService.registerCommands('exec-test', [
            {
                id: 'exec-cmd',
                description: 'Execute test',
                handler: async () => { executed = true; },
            },
        ]);
        
        const mockLog = { error: vi.fn(), log: vi.fn() };
        await commandService.executeCommand(['exec-test:exec-cmd'], mockLog);
        expect(executed).toBe(true);
    });

    it('should pass arguments to command handler', async () => {
        let receivedArgs: string[] = [];
        commandService.registerCommands('args-test', [
            {
                id: 'args-cmd',
                description: 'Args test',
                handler: async (args) => { receivedArgs = args; },
            },
        ]);
        
        const mockLog = { error: vi.fn(), log: vi.fn() };
        await commandService.executeCommand(['args-test:args-cmd', 'arg1', 'arg2'], mockLog);
        expect(receivedArgs).toEqual(['arg1', 'arg2']);
    });

    it('should handle unknown commands', async () => {
        const mockLog = { error: vi.fn(), log: vi.fn() };
        await commandService.executeCommand(['unknown-command'], mockLog);
        expect(mockLog.error).toHaveBeenCalledWith('unknown command: unknown-command');
    });

    it('should execute raw commands', async () => {
        let executed = false;
        commandService.registerCommands('raw-test', [
            {
                id: 'raw-cmd',
                description: 'Raw test',
                handler: async () => { executed = true; },
            },
        ]);
        
        const mockLog = { error: vi.fn(), log: vi.fn() };
        await commandService.executeRawCommand('raw-test:raw-cmd', mockLog);
        expect(executed).toBe(true);
    });

    it('should get command by id', () => {
        commandService.registerCommands('get-test', [
            {
                id: 'get-cmd',
                description: 'Get test',
                handler: async () => {},
            },
        ]);
        
        const cmd = commandService.getCommand('get-test:get-cmd');
        expect(cmd).toBeDefined();
        expect(cmd?.id).toBe('get-test:get-cmd');
    });

    it('should execute help command', async () => {
        const mockLog = { error: vi.fn(), log: vi.fn() };
        await commandService.executeCommand(['help'], mockLog);
        expect(mockLog.log).toHaveBeenCalledWith('available commands:');
    });

    it('should support command completers', () => {
        commandService.registerCommands('complete-test', [
            {
                id: 'complete-cmd',
                description: 'Complete test',
                handler: async () => {},
                completer: (args) => ['option1', 'option2'],
            },
        ]);
        
        const cmd = commandService.getCommand('complete-test:complete-cmd');
        const completions = cmd?.completeArgument([]);
        expect(completions).toEqual(['option1', 'option2']);
    });
});

