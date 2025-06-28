/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const { ChatAPIService } = require('./ChatAPIService');

describe('ChatAPIService', () => {
    let chatApiService;
    let mockServices;
    let mockRouter;
    let mockApp;
    let mockSUService;
    let mockAIChatService;
    let mockEndpoint;
    let mockReq;
    let mockRes;

    beforeEach(() => {
        // Mock AIChatService
        mockAIChatService = {
            simple_model_list: ['model1', 'model2'],
            detail_model_list: [
                { id: 'model1', name: 'Model 1', cost: { input: 1, output: 2 } },
                { id: 'model2', name: 'Model 2', cost: { input: 3, output: 4 } }
            ]
        };

        // Mock SUService
        mockSUService = {
            sudo: jest.fn().mockImplementation(async (callback) => {
                if (typeof callback === 'function') {
                    return await callback();
                }
                return await mockSUService.sudo.mockImplementation(async (cb) => await cb());
            })
        };

        // Mock services
        mockServices = {
            get: jest.fn().mockImplementation((serviceName) => {
                if (serviceName === 'su') return mockSUService;
                if (serviceName === 'ai-chat') return mockAIChatService;
                return null;
            })
        };

        // Mock router and app
        mockRouter = {
            use: jest.fn(),
            get: jest.fn(),
            post: jest.fn()
        };
        mockApp = {
            use: jest.fn()
        };

        // Mock Endpoint function
        mockEndpoint = jest.fn().mockReturnValue({
            attach: jest.fn()
        });

        // Mock request and response
        mockReq = {};
        mockRes = {
            json: jest.fn()
        };

        // Setup ChatAPIService
        chatApiService = new ChatAPIService();
        chatApiService.services = mockServices;
        chatApiService.log = {
            error: jest.fn()
        };
        
        // Mock the require function
        chatApiService.require = jest.fn().mockImplementation((module) => {
            if (module === 'express') return { Router: () => mockRouter };
            return require(module);
        });
    });

    describe('install_chat_endpoints_', () => {
        it('should attach models endpoint to router', () => {
            // Setup
            global.Endpoint = mockEndpoint;

            // Execute
            chatApiService.install_chat_endpoints_({ router: mockRouter });

            // Verify
            expect(mockEndpoint).toHaveBeenCalledWith(expect.objectContaining({
                route: '/models',
                methods: ['GET']
            }));
        });

        it('should attach models/details endpoint to router', () => {
            // Setup
            global.Endpoint = mockEndpoint;

            // Execute
            chatApiService.install_chat_endpoints_({ router: mockRouter });

            // Verify
            expect(mockEndpoint).toHaveBeenCalledWith(expect.objectContaining({
                route: '/models/details',
                methods: ['GET']
            }));
        });
    });

    describe('/models endpoint', () => {
        it('should return list of models', async () => {
            // Setup
            global.Endpoint = mockEndpoint;
            chatApiService.install_chat_endpoints_({ router: mockRouter });
            
            // Get the handler function
            const handler = mockEndpoint.mock.calls[0][0].handler;
            
            // Execute
            await handler(mockReq, mockRes);
            
            // Verify
            expect(mockSUService.sudo).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({ 
                models: mockAIChatService.simple_model_list 
            });
        });
    });

    describe('/models/details endpoint', () => {
        it('should return detailed list of models', async () => {
            // Setup
            global.Endpoint = mockEndpoint;
            chatApiService.install_chat_endpoints_({ router: mockRouter });
            
            // Get the handler function
            const handler = mockEndpoint.mock.calls[1][0].handler;
            
            // Execute
            await handler(mockReq, mockRes);
            
            // Verify
            expect(mockSUService.sudo).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({ 
                models: mockAIChatService.detail_model_list 
            });
        });
    });
});