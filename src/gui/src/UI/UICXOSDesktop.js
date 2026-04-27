/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import launch_app from '../helpers/launch_app.js';
import UIWindowSettings from './Settings/UIWindowSettings.js';
import {
    AGENTIC_FALLBACK,
    APP_SECTIONS,
    CODE_FALLBACK,
    COMMAND_FALLBACK,
    CONFLUENCE_FALLBACK,
    DESKTOP_APPS,
    DOCK_APPS,
    JIRA_FALLBACK,
    MCP_FALLBACK,
    SECTIONS,
    SYSTEM_STATUS,
} from '../havas-agentic-os/demoData.js';
import { agenticOSStyles } from '../havas-agentic-os/styles.js';

const DEFAULT_SECTION = 'app-center';
const DEFAULT_VIEW = 'home';
const DEFAULT_AGENT = 'cx-agent';
const CHAT_COMMANDS = ['/plan', '/review', '/publish', '/audit'];
const PRODUCT_SLUGS = new Set(['app-center', 'dev-center', 'marketplace', 'settings', 'task-monitor']);
const NATIVE_SLUGS = new Set(['explorer', 'documents', 'presentations', 'editor']);
const MCP_WINDOWS = new Set(['mcp-connections', 'code-workspace', 'jira', 'confluence']);
const APP_BY_NAME = new Map(DESKTOP_APPS.concat(DOCK_APPS).filter(item => item.name).map(item => [item.name, item]));

const escapeHTML = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#039;');

const mcpFetch = async (path, fallback, options = {}) => {
    try {
        const response = await fetch(`/api/havas-agentic-os/mcp/${path}`, {
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            method: options.method || 'GET',
            body: options.body,
        });
        if ( ! response.ok ) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data?.data || data?.[path] || data || fallback;
    } catch {
        return fallback;
    }
};

const asArray = value => Array.isArray(value) ? value : [];
const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const asText = value => value == null ? '' : String(value);
const pickFirst = (...values) => values.find(value => value != null && value !== '');
const titleCase = value => asText(value)
    .replaceAll(/[_:.-]+/g, ' ')
    .replace(/\b\w/g, part => part.toUpperCase());
const toneForState = value => {
    const state = asText(value).toLowerCase();
    if ( ['connected', 'approved', 'complete', 'completed', 'running', 'installed', 'healthy', 'logged'].some(token => state.includes(token)) ) return 'good';
    if ( ['pending', 'review', 'queued', 'progress', 'read only', 'readonly', 'degraded', 'draft', 'required'].some(token => state.includes(token)) ) return 'warn';
    if ( ['blocked', 'failed', 'revoked', 'denied', 'disconnected', 'offline', 'rejected'].some(token => state.includes(token)) ) return 'bad';
    return 'neutral';
};
const countApproved = scopes => asArray(scopes).filter(scope => !asText(scope).endsWith(':write')).length;
const humanTime = value => {
    if ( ! value ) return 'recent';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? asText(value) : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const normalizeFlag = value => {
    if ( typeof value === 'boolean' ) return value;
    const state = asText(value).toLowerCase();
    if ( ! state ) return null;
    if ( ['true', 'yes', 'available', 'enabled', 'ready', 'connected', 'ok'].includes(state) ) return true;
    if ( ['false', 'no', 'blocked', 'disabled', 'forbidden', 'unavailable', 'offline'].includes(state) ) return false;
    return null;
};

const availabilityRow = (label, available, detail) => ({
    label,
    available,
    detail,
    tone: available === true ? 'good' : (available === false ? 'bad' : 'warn'),
    value: available === true ? 'Available' : (available === false ? 'Unavailable' : 'Unknown'),
});

const normalizeJiraAvailability = (base, connection, tools) => {
    const meta = base?.availability || base?.meta?.availability || base?.state?.availability || {};
    const resource = base?.resource || base?.site || meta?.resource || {};
    const cloudId = pickFirst(base?.cloudId, resource?.cloudId, meta?.cloudId, connection?.cloudId, connection?.resource?.cloudId);
    const projectsAvailable = normalizeFlag(pickFirst(meta?.projects, meta?.projectsAvailable, asArray(base.projects).length ? true : null));
    const searchAvailable = normalizeFlag(pickFirst(meta?.search, meta?.searchAvailable, meta?.rovoSearch));
    const searchReason = pickFirst(meta?.searchReason, meta?.rovoReason, base?.searchStatus, connection?.searchStatus);
    return {
        cloudId,
        rows: [
            availabilityRow('Projects', projectsAvailable, projectsAvailable === true ? `${asArray(base.projects).length} project entries loaded` : 'No project payload yet'),
            availabilityRow('Search', searchAvailable, searchReason || 'Depends on Atlassian search/Rovo access'),
            availabilityRow('Write tools', asArray(tools).some(tool => tool.write) ? null : true, `${asArray(tools).filter(tool => tool.write).length} gated write tools`),
        ],
    };
};

const normalizeConfluenceAvailability = (base, connection, tools) => {
    const meta = base?.availability || base?.meta?.availability || base?.state?.availability || {};
    const resource = base?.resource || base?.site || meta?.resource || {};
    const cloudId = pickFirst(base?.cloudId, resource?.cloudId, meta?.cloudId, connection?.cloudId, connection?.resource?.cloudId);
    const discoveryAvailable = normalizeFlag(pickFirst(meta?.discovery, meta?.discoveryAvailable, meta?.search, asArray(base.spaces).length ? true : null));
    const blockedReason = pickFirst(meta?.discoveryReason, meta?.blockedReason, meta?.searchReason, connection?.lastError);
    const viewerAvailable = normalizeFlag(pickFirst(meta?.viewer, meta?.viewerAvailable, base?.viewer ? true : null));
    return {
        cloudId,
        rows: [
            availabilityRow('Discovery', discoveryAvailable, blockedReason || 'Requires backend discovery payload'),
            availabilityRow('Viewer', viewerAvailable, viewerAvailable === true ? 'Page payload available' : 'No viewer payload yet'),
            availabilityRow('Write tools', asArray(tools).some(tool => tool.write) ? null : true, `${asArray(tools).filter(tool => tool.write).length} gated write tools`),
        ],
    };
};

const renderAvailabilityPanel = (title, availability) => `
    <section class="ha-availability-panel">
        <div class="ha-availability-header">
            <h2>${escapeHTML(title)}</h2>
            ${availability.cloudId ? `<span class="ha-pill neutral">${escapeHTML(`cloudId ${availability.cloudId}`)}</span>` : ''}
        </div>
        <div class="ha-availability-grid">
            ${asArray(availability.rows).map(item => `
                <article class="ha-availability-card">
                    <strong>${escapeHTML(item.label)}</strong>
                    <span class="ha-pill ${escapeHTML(item.tone)}">${escapeHTML(item.value)}</span>
                    <p>${escapeHTML(item.detail)}</p>
                </article>
            `).join('')}
        </div>
    </section>
`;

const normalizeProjectRows = projects => asArray(projects).map((item, index) => ({
    key: pickFirst(item.key, item.projectKey, item.id, `P${index + 1}`),
    name: pickFirst(item.name, item.projectName, item.title, 'Untitled project'),
    meta: [
        pickFirst(item.projectTypeKey, item.type, item.style),
        pickFirst(item.lead?.displayName, item.lead?.name, item.lead),
        pickFirst(item.state, item.status),
    ].filter(Boolean).join(' | ') || 'Atlassian project payload',
}));

const normalizeBoardRows = boards => asArray(boards).map((item, index) => ({
    name: pickFirst(item.name, item.title, `Board ${index + 1}`),
    meta: [
        pickFirst(item.type, item.boardType, item.location?.type),
        pickFirst(item.location?.projectKey, item.projectKey),
    ].filter(Boolean).join(' | ') || 'Board payload',
}));

const normalizeIssueRows = issues => asArray(issues).map((item, index) => ({
    key: pickFirst(item.key, item.id, `ISSUE-${index + 1}`),
    title: pickFirst(item.title, item.fields?.summary, item.summary, 'Untitled issue'),
    assignee: pickFirst(item.assignee, item.fields?.assignee?.displayName, item.fields?.assignee?.name, 'Unassigned'),
    status: pickFirst(item.status, item.fields?.status?.name, item.state, 'Unknown'),
}));

const normalizeCommentRows = comments => asArray(comments).map(item => ({
    author: pickFirst(item.author, item.author?.displayName, item.author?.name, 'Atlassian'),
    text: pickFirst(item.text, item.body, item.message, 'No comment body'),
}));

const normalizeSearchRows = rows => asArray(rows).map((item, index) => ({
    title: pickFirst(item.title, item.name, item.content?.title, `Result ${index + 1}`),
    excerpt: pickFirst(item.excerpt, item.summary, item.content?.excerpt, item.reason, 'Result payload received'),
    status: pickFirst(item.status, item.type, item.space, item.scope, 'Result'),
}));

const normalizeWriteTools = (tools, connection) => asArray(tools)
    .filter(tool => tool.write)
    .map(tool => ({
        name: tool.name,
        state: pickFirst(tool.approvalState, tool.state, 'Approval required'),
        detail: pickFirst(tool.detail, 'Write action remains gated until approved.'),
        approvalScope: asArray(tool.permissions).find(scope => scope.endsWith(':write')) || asArray(tool.permissions)[0] || null,
        permissionDecision: connection?.approvalMode === 'approve_once' ? 'approved_once' : connection?.approvalMode === 'not_required' ? 'allowed' : 'denied',
        auditId: tool.auditId || null,
    }));

const normalizeAuditRows = (audits, fallbackTarget) => asArray(audits).map((event, index) => ({
    id: event.id || `${fallbackTarget}-${index}`,
    action: pickFirst(event.action, event.type, 'mcp.event'),
    actor: pickFirst(event.actor, event.user, 'system'),
    target: pickFirst(event.target, fallbackTarget),
    createdAt: humanTime(event.createdAt),
}));

const iconHTML = item => `
    <button class="ha-desk-icon" type="button" data-name="${escapeHTML(item.name)}">
        <span class="ha-icon ${escapeHTML(item.tone)}">${escapeHTML(item.glyph)}</span>
        <span>${escapeHTML(item.title)}</span>
    </button>
`;

const dockHTML = item => item.sep
    ? '<div class="ha-dock-sep" aria-hidden="true"></div>'
    : `
        <button class="ha-dock-item" type="button" data-name="${escapeHTML(item.name)}" title="${escapeHTML(item.title)}">
            <span class="ha-dock-label">${escapeHTML(item.title)}</span>
            <span class="ha-icon ${escapeHTML(item.tone)}">${escapeHTML(item.glyph)}</span>
        </button>
    `;

const statusHTML = () => SYSTEM_STATUS.map(item => `
    <div class="ha-status-card">
        <span>${escapeHTML(item.label)}</span>
        <strong>${escapeHTML(item.value)}</strong>
        <small>${escapeHTML(item.detail)}</small>
    </div>
`).join('');

const titlebarHTML = (id, title, subtitle) => `
    <header class="ha-titlebar">
        <div>
            <strong>${escapeHTML(title)}</strong>
            <span>${escapeHTML(subtitle)}</span>
        </div>
        <div class="ha-title-actions">
            <button class="ha-ghost" type="button" data-window-refresh="${escapeHTML(id)}">Refresh</button>
            <button class="ha-ghost" type="button" data-window-close="${escapeHTML(id)}">Close</button>
        </div>
    </header>
`;

const createMarkup = () => `
    <div class="ha-wallpaper"></div>
    <div class="ha-topbar">
        <strong>Havas Agentic OS</strong>
        <span>MCP-first CODE | JIRA | CONFLUENCE</span>
        <time>${time()}</time>
    </div>
    <div class="ha-desktop-icons">${DESKTOP_APPS.map(iconHTML).join('')}</div>
    <section class="ha-window open" data-window="agentic-os" aria-label="Havas Agentic OS">
        <header class="ha-titlebar">
            <div>
                <strong>Havas Agentic OS</strong>
                <span>Publish, govern, observe, and operate agents</span>
            </div>
            <div class="ha-title-actions">
                <button class="ha-ghost" type="button" data-refresh>Refresh</button>
                <button class="ha-ghost" type="button" data-window-close="agentic-os">Close</button>
            </div>
        </header>
        <div class="ha-body">
            <aside class="ha-nav"></aside>
            <main class="ha-main">
                <div class="ha-hero">
                    <div>
                        <h1>Agentic control center</h1>
                        <p>MCP-backed app inventory, code workspaces, Jira delivery state, Confluence knowledge, approvals, and task observation.</p>
                    </div>
                    <div class="ha-status-grid">${statusHTML()}</div>
                </div>
                <div class="ha-toolbar">
                    <input class="ha-search" type="search" placeholder="Search apps, agents, workers, logs" />
                    <div class="ha-chips"></div>
                </div>
                <div class="ha-content" aria-live="polite"></div>
            </main>
        </div>
    </section>
    <section class="ha-window ha-integration-window" data-window="mcp-connections" aria-label="MCP Connections">
        ${titlebarHTML('mcp-connections', 'MCP Connections', 'Connection state, scopes, permissions, and approvals')}
        <div class="ha-integration-body ha-mcp-body">
            <div class="ha-mcp-list"></div>
            <aside class="ha-approval-panel"></aside>
        </div>
    </section>
    <section class="ha-window ha-integration-window ha-code-window" data-window="code-workspace" aria-label="Code Workspace">
        ${titlebarHTML('code-workspace', 'Code Workspace', 'Tree, File, Diff, History, Search, PR, and agent panel')}
        <div class="ha-code-body">
            <aside class="ha-code-tree"></aside>
            <main class="ha-code-main">
                <div class="ha-code-tabs"></div>
                <div class="ha-code-content"></div>
            </main>
            <aside class="ha-code-agent"></aside>
        </div>
    </section>
    <section class="ha-window ha-integration-window" data-window="jira" aria-label="Jira">
        ${titlebarHTML('jira', 'Jira', 'Projects, boards, issues, comments, and acceptance criteria')}
        <div class="ha-jira-body">
            <aside class="ha-jira-sidebar"></aside>
            <main class="ha-jira-main"></main>
        </div>
    </section>
    <section class="ha-window ha-integration-window" data-window="confluence" aria-label="Confluence">
        ${titlebarHTML('confluence', 'Confluence', 'Spaces, recent pages, search, viewer, and ask mode')}
        <div class="ha-confluence-body">
            <aside class="ha-confluence-sidebar"></aside>
            <main class="ha-confluence-main"></main>
        </div>
    </section>
    <section class="ha-chat" aria-label="Agent command console">
        <header>
            <div><strong>Agent Console</strong><span>MCP task monitor command line</span></div>
            <button class="ha-ghost" type="button" data-chat-reset>Reset</button>
        </header>
        <div class="ha-messages"></div>
        <div class="ha-commands">${CHAT_COMMANDS.map(cmd => `<button type="button" data-command="${cmd}">${cmd}</button>`).join('')}</div>
        <form class="ha-chat-form">
            <input autocomplete="off" placeholder="Ask for a plan, review, publish, or audit..." />
            <button type="submit">Send</button>
        </form>
    </section>
    <div class="ha-palette" hidden>
        <div class="ha-palette-box">
            <input class="ha-palette-input" autocomplete="off" />
            <div class="ha-palette-results"></div>
        </div>
    </div>
    <div class="ha-dock">${DOCK_APPS.map(dockHTML).join('')}</div>
`;

const emptyHTML = label => `<div class="ha-empty">No ${escapeHTML(label)} matched the current filters.</div>`;

const renderCards = items => items.length ? `
    <div class="ha-card-grid">
        ${items.map(item => `
            <article class="ha-card" data-product="${escapeHTML(item.id || item.name || item.title)}">
                <div class="ha-card-top">
                    <span class="ha-card-icon">${escapeHTML(item.glyph || '[]')}</span>
                    <span class="ha-pill ${escapeHTML(item.statusTone || 'neutral')}">${escapeHTML(item.status || item.kind || 'Ready')}</span>
                </div>
                <h3>${escapeHTML(item.title)}</h3>
                <p>${escapeHTML(item.summary)}</p>
                <div class="ha-meta">
                    <span>${escapeHTML(item.owner || item.category || 'Havas')}</span>
                    <span>${escapeHTML(item.metric || item.version || item.updated || '')}</span>
                </div>
                <div class="ha-actions">
                    <button type="button" data-inspect="${escapeHTML(item.id || item.title)}">Inspect</button>
                    <button type="button" data-request="${escapeHTML(item.id || item.title)}">Request</button>
                </div>
            </article>
        `).join('')}
    </div>
` : emptyHTML('cards');

const renderRows = items => items.length ? `
    <div class="ha-table">
        ${items.map(item => `
            <button class="ha-row" type="button" data-inspect="${escapeHTML(item.id || item.title)}">
                <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.summary || item.detail)}</small></span>
                <span>${escapeHTML(item.owner || item.scope || item.actor || item.phase || '')}</span>
                <span class="ha-pill ${escapeHTML(item.statusTone || 'neutral')}">${escapeHTML(item.status || item.risk || item.state || 'Open')}</span>
            </button>
        `).join('')}
    </div>
` : emptyHTML('rows');

const filterItems = (items, query, filter) => items.filter(item => {
    const haystack = Object.values(item).join(' ').toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesFilter = filter === 'all' || haystack.includes(filter);
    return matchesQuery && matchesFilter;
});

const renderTaskMonitor = (items, approvals, jiraProposals = []) => `
    <div class="ha-task-monitor-grid">
        <section>
            <h2>Plan-act-observe</h2>
            ${renderRows(items)}
        </section>
        <section>
            <h2>Jira proposals pending (${jiraProposals.length})</h2>
            <div class="ha-table">
                ${jiraProposals.map(item => `
                    <button class="ha-row compact proposal" type="button" data-inspect="${escapeHTML(item.id)}">
                        <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></span>
                        <span>${escapeHTML(item.owner)}</span>
                        <span class="ha-pill ${escapeHTML(item.statusTone || 'neutral')}">${escapeHTML(item.state)}</span>
                    </button>
                `).join('')}
            </div>
        </section>
        <section>
            <h2>Permission states and approvals</h2>
            <div class="ha-table">
                ${approvals.map(item => `
                    <button class="ha-row compact" type="button" data-inspect="${escapeHTML(item.id)}">
                        <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></span>
                        <span>${escapeHTML(item.owner)}</span>
                        <span class="ha-pill ${escapeHTML(item.statusTone || 'neutral')}">${escapeHTML(item.state)}</span>
                    </button>
                `).join('')}
            </div>
        </section>
    </div>
`;

const deriveMonitorRows = monitor => {
    const state = monitor?.state || {};
    const tasks = asArray(state.tasks).map(task => ({
        id: task.id || task.title,
        title: `${titleCase(task.status || 'task')}: ${task.title || task.id || 'Untitled task'}`,
        state: titleCase(task.status || 'queued'),
        statusTone: toneForState(task.status),
        actor: task.agentId || task.actor || 'Agent',
        summary: task.result?.message || (task.progress != null ? `${task.progress}% complete` : 'Awaiting result'),
        phase: task.status || 'queued',
    }));
    const audits = asArray(state.audits).map(event => ({
        id: event.id || `${event.action}-${event.createdAt}`,
        title: `Audit: ${event.action || 'mcp.event'}`,
        state: 'Logged',
        statusTone: 'neutral',
        actor: event.actor || 'system',
        summary: `${event.target || 'unknown'} • ${humanTime(event.createdAt)}`,
        phase: 'completed',
    }));
    const connections = asArray(state.connections).map(connection => ({
        id: `${connection.serverId}-state`,
        title: `Connection: ${asText(connection.serverId).toUpperCase()} MCP`,
        state: titleCase(connection.status || 'unknown'),
        statusTone: toneForState(connection.status),
        actor: connection.serverId?.toUpperCase() || 'MCP',
        summary: `${connection.grantedPermissions?.length || 0}/${connection.requestedPermissions?.length || 0} permissions granted`,
        phase: connection.status === 'connected' ? 'running' : 'failed',
    }));
    return {
        plan: tasks.filter(item => ['queued', 'pending', 'submitted'].includes(asText(item.phase).toLowerCase())),
        act: tasks.filter(item => ['running', 'in progress'].includes(asText(item.phase).toLowerCase())).concat(connections),
        observe: tasks.filter(item => !['queued', 'pending', 'submitted', 'running', 'in progress'].includes(asText(item.phase).toLowerCase())).concat(audits),
    };
};

const normalizeApprovals = (approvals, tools = []) => {
    const writeToolsByServer = asArray(tools).reduce((acc, tool) => {
        const serverId = tool.serverId || 'mcp';
        if ( tool.write ) acc[serverId] = (acc[serverId] || 0) + 1;
        return acc;
    }, {});
    return asArray(approvals).map(item => {
        const owner = item.owner || item.actor || 'MCP';
        const serverId = asText(item.id || owner).split(':')[0].toLowerCase();
        const state = item.state || item.status || 'Pending';
        return {
            ...item,
            title: item.title || titleCase(item.id || `${owner} approval`),
            owner,
            state,
            statusTone: item.statusTone || toneForState(state),
            detail: item.detail || `${writeToolsByServer[serverId] || 0} write tools remain gated.`,
        };
    });
};

const normalizeJiraProposals = (proposals = {}) => {
    const pending = asArray(proposals?.proposals);
    const mode = proposals?.writePath?.mode || 'unknown';
    return pending.map(item => ({
        id: item.proposalId,
        title: `Jira proposal: ${titleCase(item.toolName)}`,
        owner: item.actor || 'JIRA MCP',
        detail: item.description || 'Proposal-only action. Approve to audit.',
        state: item.status || 'Awaiting approval',
        statusTone: item.statusTone || 'warn',
        auditId: item.auditId || 'Pending audit',
        createdAt: humanTime(item.createdAt),
        writePath: mode,
    }));
};

const normalizeConnectionsData = ({ connections, approvals, capabilities, tools, health, monitor }) => {
    const toolList = asArray(tools?.tools || tools);
    const capabilityList = asArray(capabilities?.capabilities || capabilities);
    const healthMap = health?.health || {};
    const auditEvents = asArray(monitor?.state?.audits);
    const normalizedConnections = asArray(connections?.connections || connections).map(connection => {
        const serverId = connection.id || connection.serverId;
        const serverTools = toolList.filter(tool => tool.serverId === serverId);
        const serverCapabilities = capabilityList.filter(capability => capability.serverId === serverId);
        const serverHealth = healthMap?.[serverId] || healthMap;
        const pendingWrites = asArray(connection.scopes).filter(scope => asText(scope).endsWith(':write')).length;
        const recentAudit = auditEvents.find(event => asText(event.target).toLowerCase().includes(asText(serverId).toLowerCase()));
        return {
            ...connection,
            id: serverId,
            title: connection.title || `${asText(serverId).toUpperCase()} MCP`,
            statusTone: connection.statusTone || toneForState(connection.status),
            permission: connection.permission || `${countApproved(connection.scopes)}/${asArray(connection.scopes).length} granted`,
            approval: pendingWrites ? `${pendingWrites} write scope${pendingWrites === 1 ? '' : 's'} gated` : (connection.approval || 'read-only'),
            capabilities: serverCapabilities,
            tools: serverTools,
            health: serverHealth?.status || serverHealth?.checkedAt || 'unknown',
            lastAudit: recentAudit ? `${recentAudit.action} • ${humanTime(recentAudit.createdAt)}` : 'No recent audit event',
            lastError: connection.lastError || '',
        };
    });
    return {
        connections: normalizedConnections.length ? normalizedConnections : MCP_FALLBACK.connections,
        approvals: normalizeApprovals(approvals?.approvals || approvals, toolList),
    };
};

const summarizeConnection = item => {
    const toolCount = asArray(item.tools).length;
    const writeCount = asArray(item.tools).filter(tool => tool.write).length;
    const capabilityCount = asArray(item.capabilities).length;
    return `${item.provider} | ${item.permission} | ${capabilityCount} capabilities | ${toolCount} tools${writeCount ? ` | ${writeCount} write gated` : ''}`;
};

const normalizeCodeData = ({ code, connections, capabilities, tools, monitor }) => {
    const base = code?.data || code || CODE_FALLBACK;
    const toolList = asArray(tools?.tools || tools).filter(tool => tool.serverId === 'code');
    const connection = asArray(connections?.connections || connections).find(item => (item.id || item.serverId) === 'code');
    const capabilityList = asArray(capabilities?.capabilities || capabilities).filter(item => item.serverId === 'code');
    const audits = asArray(monitor?.state?.audits).filter(event => asText(event.target).toLowerCase().includes('code'));
    const fileStatus = connection
        ? `${connection.status} • ${connection.permission || `${connection.grantedPermissions?.length || 0}/${connection.requestedPermissions?.length || 0} granted`}`
        : base.file?.status;
    return {
        ...base,
        file: {
            ...base.file,
            status: fileStatus || CODE_FALLBACK.file.status,
        },
        pr: asArray(base.pr).concat(connection ? [{
            title: 'Workspace permission state',
            state: connection.status || 'Unknown',
            checks: `${toolList.filter(tool => tool.write).length} write tools require approval`,
        }] : []),
        agent: asArray(base.agent).concat(
            capabilityList.map(capability => ({
                role: titleCase(capability.name),
                text: `${asArray(capability.permissions).join(', ')} via ${connection?.status || 'fallback'} connection.`,
            })),
            audits[0] ? [{ role: 'Audit', text: `${audits[0].action} on ${humanTime(audits[0].createdAt)}.` }] : [],
            toolList.length ? [{ role: 'Tools', text: toolList.map(tool => `${tool.name}${tool.write ? ' [approval]' : ''}`).join(' • ') }] : [],
        ),
    };
};

const normalizeJiraData = ({ jira, connections, tools, monitor }) => {
    const base = jira?.data || jira || JIRA_FALLBACK;
    const connection = asArray(connections?.connections || connections).find(item => (item.id || item.serverId) === 'jira');
    const toolList = asArray(tools?.tools || tools).filter(tool => tool.serverId === 'jira');
    const proposalTools = asArray(tools?.proposalTools || base?.tools?.proposals || []).filter(tool => (tool.serverId || 'jira') === 'jira');
    const audits = asArray(monitor?.state?.audits).filter(event => asText(event.target).toLowerCase().includes('jira'));
    const issueEvidenceRows = normalizeIssueRows(base?.issueEvidence?.issues);
    const searchBlockedReason = pickFirst(
        base?.availability?.searchReason,
        base?.meta?.availability?.searchReason,
        base?.searchStatus,
        base?.search?.reason,
        connection?.lastError,
        'Search is blocked until Atlassian search access is restored.',
    );
    const proposals = asArray(base?.proposals || []).map(item => ({
        proposalId: pickFirst(item.proposalId, item.id, 'unknown'),
        toolName: pickFirst(item.toolName, item.tool, 'jira.proposal'),
        description: pickFirst(item.description, 'Jira proposal action'),
        actor: pickFirst(item.actor, 'operator'),
        auditId: item.auditId || null,
        createdAt: humanTime(item.createdAt),
    }));
    const writePath = base?.writePath || { mode: 'proposal', note: 'Jira write tools are proposal-and-approval flows. No live write executed.', proposalToolCount: asArray(tools).filter(t => t.write && t.serverId === 'jira').length, approvalRequired: true };
    return {
        ...base,
        _connection: connection ? {
            status: connection.status,
            permission: connection.permission || `${connection.grantedPermissions?.length || 0}/${connection.requestedPermissions?.length || 0} granted`,
            approval: connection.approval || connection.approvalMode || 'read-only',
        } : null,
        _tools: toolList.map(tool => ({ name: tool.name, write: tool.write, serverId: tool.serverId, proposalDescription: tool.proposalDescription })),
        _proposals: proposals,
        _proposalTools: proposalTools.length ? proposalTools : asArray(base?.tools?.proposals || []).map(item => ({ name: item.name, proposalDescription: item.description })),
        _writePath: writePath,
        availability: normalizeJiraAvailability(base, connection, toolList),
        projects: normalizeProjectRows(base.projects),
        boards: normalizeBoardRows(base.boards),
        issues: normalizeIssueRows(base.issues).length
            ? normalizeIssueRows(base.issues)
            : issueEvidenceRows.map(item => ({
                ...item,
                title: `${item.title} [Evidence]`,
            })),
        issueEvidence: {
            ...base.issueEvidence,
            issues: issueEvidenceRows,
        },
        comments: normalizeCommentRows(base.comments).concat(connection ? [{
            author: 'MCP State',
            text: `${connection.status} • ${connection.permission || `${connection.grantedPermissions?.length || 0}/${connection.requestedPermissions?.length || 0} granted`} • ${toolList.filter(tool => tool.write).length} write tools gated.`,
        }] : []),
        acceptanceCriteria: asArray(base.acceptanceCriteria).concat(
            toolList.filter(tool => tool.write).map(tool => `${tool.name} requires approval before execution.`),
            audits[0] ? [`Latest audit: ${audits[0].action} at ${humanTime(audits[0].createdAt)}.`] : [],
        ),
        searchState: {
            available: normalizeFlag(pickFirst(base?.availability?.search, base?.meta?.availability?.search, base?.search?.available)),
            reason: searchBlockedReason,
        },
        evidenceState: base.issueEvidence?.issues?.length
            ? {
                available: true,
                reason: base.issueEvidence?.note || 'Imported operator-verified Jira evidence is available.',
            }
            : null,
        writeTools: normalizeWriteTools(toolList, connection),
        audits: normalizeAuditRows(audits, 'jira'),
    };
};

const normalizeConfluenceData = ({ confluence, connections, tools, monitor }) => {
    const base = confluence?.data || confluence || CONFLUENCE_FALLBACK;
    const connection = asArray(connections?.connections || connections).find(item => (item.id || item.serverId) === 'confluence');
    const toolList = asArray(tools?.tools || tools).filter(tool => tool.serverId === 'confluence');
    const audits = asArray(monitor?.state?.audits).filter(event => asText(event.target).toLowerCase().includes('confluence'));
    const discoveryBlockedReason = pickFirst(
        base?.availability?.discoveryReason,
        base?.meta?.availability?.discoveryReason,
        base?.searchStatus,
        connection?.lastError,
        'Discovery is blocked until backend Confluence discovery returns data.',
    );
    return {
        ...base,
        availability: normalizeConfluenceAvailability(base, connection, toolList),
        spaces: asArray(base.spaces).map((item, index) => ({
            key: pickFirst(item.key, item.id, `SPACE-${index + 1}`),
            name: pickFirst(item.name, item.title, 'Untitled space'),
            access: pickFirst(item.access, item.permission, item.status, 'Unknown'),
        })),
        recent: normalizeSearchRows(base.recent).map(item => ({
            ...item,
            status: item.status === 'Result' ? 'Recent' : item.status,
        })),
        search: normalizeSearchRows(base.search),
        ask: asArray(base.ask).concat(connection ? [{
            question: 'What can this MCP do now?',
            answer: `${connection.status} with ${connection.permission || `${connection.grantedPermissions?.length || 0}/${connection.requestedPermissions?.length || 0} granted`}; ${toolList.filter(tool => tool.write).length} write tools still need approval.`,
        }] : []),
        viewer: {
            ...base.viewer,
            body: `${base.viewer?.body || ''} ${audits[0] ? `Latest audit: ${audits[0].action} on ${humanTime(audits[0].createdAt)}.` : ''}`.trim(),
        },
        discoveryState: {
            available: normalizeFlag(pickFirst(base?.availability?.discovery, base?.meta?.availability?.discovery, asArray(base.spaces).length ? true : null)),
            reason: discoveryBlockedReason,
        },
        writeTools: normalizeWriteTools(toolList, connection),
        audits: normalizeAuditRows(audits, 'confluence'),
    };
};

const normalizeCommandItems = ({ commands, tools, approvals, jiraProposals }) => {
    const toolList = asArray(tools?.tools || tools);
    const approvalRows = normalizeApprovals(approvals?.approvals || approvals, toolList);
    const proposals = asArray(jiraProposals?.proposals);
    return asArray(commands?.commands || commands).map(item => {
        const toolName = item.type?.startsWith('mcp:') ? item.type.replace('mcp:', '') : '';
        const tool = toolList.find(entry => entry.name === toolName);
        const relatedApproval = approvalRows.find(entry => asText(entry.id).includes(tool?.serverId || '') && asText(entry.id).includes(':write'));

        if ( item.id === 'jira-proposals' ) {
            return {
                ...item,
                title: `Review Jira proposals (${proposals.length} pending)`,
                subtitle: `JIRA • ${proposals.length} proposal${proposals.length === 1 ? '' : 's'} pending • ${jiraProposals?.writePath?.mode || 'proposal'}`,
                status: proposals.length ? 'warn' : 'neutral',
            };
        }

        return {
            ...item,
            status: tool ? (tool.write ? 'approval' : 'read') : item.status,
            subtitle: tool
                ? tool.write
                    ? `${tool.serverId?.toUpperCase()} • ${asArray(tool.permissions).join(', ')} • ${relatedApproval?.approvalScope || ''} • ${relatedApproval?.state || 'Pending'}`
                    : `${tool.serverId?.toUpperCase()} • ${asArray(tool.permissions).join(', ')}`
                : item.type,
        };
    });
};

const wireAgenticOS = root => {
    const win = root.querySelector('[data-window="agentic-os"]');
    const nav = root.querySelector('.ha-nav');
    const chips = root.querySelector('.ha-chips');
    const content = root.querySelector('.ha-content');
    const search = root.querySelector('.ha-search');
    let activeSection = DEFAULT_SECTION;
    let activeView = DEFAULT_VIEW;
    let activeFilter = 'all';
    let cache = AGENTIC_FALLBACK;
    let approvals = MCP_FALLBACK.approvals;
    let jiraProposals = [];

    const activeConfig = () => SECTIONS.find(section => section.id === activeSection) || SECTIONS[0];
    const dataFor = () => (cache[activeSection] || {})[activeView] || [];

    const renderNav = () => {
        nav.innerHTML = SECTIONS.map(section => `
            <button class="${section.id === activeSection ? 'active' : ''}" type="button" data-section="${escapeHTML(section.id)}">
                <span>${escapeHTML(section.glyph)}</span>
                <span><strong>${escapeHTML(section.title)}</strong><small>${escapeHTML(section.summary)}</small></span>
            </button>
        `).join('');
    };

    const renderChips = () => {
        const config = activeConfig();
        const views = config.views.map(view => `
            <button class="${view.id === activeView ? 'active' : ''}" type="button" data-view="${escapeHTML(view.id)}">${escapeHTML(view.label)}</button>
        `).join('');
        const filters = ['all'].concat(config.filters).map(filter => `
            <button class="${filter === activeFilter ? 'active' : ''}" type="button" data-filter="${escapeHTML(filter)}">${escapeHTML(filter)}</button>
        `).join('');
        chips.innerHTML = `${views }<span class="ha-chip-gap"></span>${ filters}`;
    };

    const renderContent = () => {
        const query = search.value.trim().toLowerCase();
        const items = filterItems(dataFor(), query, activeFilter);
        if ( activeSection === 'task-monitor' ) {
            content.innerHTML = renderTaskMonitor(items, approvals, jiraProposals);
            return;
        }
        content.innerHTML = activeConfig().mode === 'table' ? renderRows(items) : renderCards(items);
    };

    const render = () => {
        renderNav();
        renderChips();
        renderContent();
    };

    const load = async () => {
        const [dashboard, monitor] = await Promise.all([
            mcpFetch('dashboard', AGENTIC_FALLBACK),
            mcpFetch('task-monitor', { approvals: MCP_FALLBACK.approvals }),
        ]);
        cache = {
            ...(dashboard || AGENTIC_FALLBACK),
            'task-monitor': deriveMonitorRows(monitor),
        };
        approvals = normalizeApprovals(monitor.approvals || MCP_FALLBACK.approvals);
        jiraProposals = normalizeJiraProposals(monitor?.jiraProposals || {});
        render();
    };

    const openSection = sectionId => {
        const config = SECTIONS.find(section => section.id === sectionId);
        if ( ! config ) return;
        activeSection = sectionId;
        activeView = config.views[0]?.id || DEFAULT_VIEW;
        activeFilter = 'all';
        search.value = '';
        win.classList.add('open');
        render();
    };

    nav.addEventListener('click', event => {
        const button = event.target.closest('[data-section]');
        if ( button ) openSection(button.dataset.section);
    });
    chips.addEventListener('click', event => {
        const view = event.target.closest('[data-view]');
        const filter = event.target.closest('[data-filter]');
        if ( view ) activeView = view.dataset.view;
        if ( filter ) activeFilter = filter.dataset.filter;
        renderChips();
        renderContent();
    });
    search.addEventListener('input', renderContent);
    content.addEventListener('click', event => {
        const product = event.target.closest('[data-inspect], [data-request], [data-product]');
        if ( ! product ) return;
        const label = product.dataset.inspect || product.dataset.request || product.dataset.product;
        root.dispatchEvent(new CustomEvent('havas-agentic-selection', { detail: label }));
    });
    root.querySelector('[data-refresh]').addEventListener('click', load);

    load();
    return { openSection };
};

const renderMCPConnections = (root, data = MCP_FALLBACK) => {
    const connections = Array.isArray(data) ? data : (asArray(data.connections).length ? data.connections : MCP_FALLBACK.connections);
    const approvals = asArray(data.approvals).length ? data.approvals : MCP_FALLBACK.approvals;
    root.querySelector('.ha-mcp-list').innerHTML = connections.map(item => `
        <article class="ha-connection-card">
            <div>
                <strong>${escapeHTML(item.title)}</strong>
                <span>${escapeHTML(summarizeConnection(item))}</span>
            </div>
            <span class="ha-pill ${escapeHTML(item.statusTone || 'neutral')}">${escapeHTML(item.status)}</span>
            <p>${escapeHTML(item.approval)}</p>
            <div class="ha-connection-meta">
                <span>${escapeHTML(`Health: ${item.health || 'unknown'}`)}</span>
                <span>${escapeHTML(`Audit: ${item.lastAudit || 'No recent audit event'}`)}</span>
                ${item.lastError ? `<span class="ha-pill bad">${escapeHTML(item.lastError)}</span>` : ''}
            </div>
            <div class="ha-scope-list">${asArray(item.scopes).map(scope => `<span>${escapeHTML(scope)}</span>`).join('')}</div>
            ${asArray(item.tools).length ? `<div class="ha-tool-list">${asArray(item.tools).map(tool => `
                <span class="ha-tool-pill ${tool.write ? 'warn' : 'neutral'}">${escapeHTML(tool.name)}</span>
            `).join('')}</div>` : ''}
        </article>
    `).join('');
    root.querySelector('.ha-approval-panel').innerHTML = `
        <h2>Approvals and audit</h2>
        ${approvals.map(item => `
            <div class="ha-approval-item">
                <strong>${escapeHTML(item.title)}</strong>
                <span>${escapeHTML(item.owner)}</span>
                <p>${escapeHTML(item.detail)}</p>
                ${item.approvalScope ? `<p>Scope: <span class="ha-pill warn">${escapeHTML(item.approvalScope)}</span></p>` : ''}
                ${item.approvalMode ? `<p>Mode: <span class="ha-pill neutral">${escapeHTML(item.approvalMode)}</span></p>` : ''}
                <small class="ha-pill ${escapeHTML(item.statusTone || 'neutral')}">${escapeHTML(item.state)}</small>
            </div>
        `).join('')}
    `;
};

const wireMCPConnections = root => {
    const load = async () => {
        const [connections, capabilities, tools, health, monitor] = await Promise.all([
            mcpFetch('connections', MCP_FALLBACK),
            mcpFetch('capabilities', {}),
            mcpFetch('tools', {}),
            mcpFetch('health', {}),
            mcpFetch('task-monitor', {}),
        ]);
        renderMCPConnections(root, normalizeConnectionsData({ connections, approvals: monitor, capabilities, tools, health, monitor }));
    };
    load();
    return { load };
};

const codeTabs = ['File', 'Diff', 'History', 'Search', 'PR'];

const renderCodeWorkspace = (root, data = CODE_FALLBACK, activeTab = 'File') => {
    root.querySelector('.ha-code-tree').innerHTML = `
        <h2>Workspace tree</h2>
        ${asArray(data.files).map(file => `
            <button type="button" data-code-file="${escapeHTML(file.path)}">
                <span>${escapeHTML(file.path)}</span>
                <small>${escapeHTML(file.status || file.type)}</small>
            </button>
        `).join('')}
    `;
    root.querySelector('.ha-code-tabs').innerHTML = codeTabs.map(tab => `
        <button class="${tab === activeTab ? 'active' : ''}" type="button" data-code-tab="${escapeHTML(tab)}">${escapeHTML(tab)}</button>
    `).join('');
    const content = {
        File: `<pre>${escapeHTML(data.file?.body || CODE_FALLBACK.file.body)}</pre><small>${escapeHTML(`${data.file?.path || ''}${data.file?.status ? ` • ${data.file.status}` : ''}`)}</small>`,
        Diff: renderRows(asArray(data.diff).map(item => ({ title: item.file, summary: item.change, status: 'Diff', statusTone: 'warn' }))),
        History: renderRows(asArray(data.history).map(item => ({ title: item.title, summary: item.author, status: item.time, statusTone: 'neutral' }))),
        Search: renderRows(asArray(data.search).map(item => ({ title: item.file, summary: item.text, status: `L${item.line}`, statusTone: 'good' }))),
        PR: renderRows(asArray(data.pr).map(item => ({ title: item.title, summary: item.checks, status: item.state, statusTone: item.state === 'Required' ? 'warn' : 'neutral' }))),
    };
    root.querySelector('.ha-code-content').innerHTML = content[activeTab] || content.File;
    root.querySelector('.ha-code-agent').innerHTML = `
        <h2>Agent panel</h2>
        ${asArray(data.agent).map(item => `
            <div class="ha-agent-note">
                <strong>${escapeHTML(item.role)}</strong>
                <p>${escapeHTML(item.text)}</p>
            </div>
        `).join('')}
        <button class="ha-primary" type="button" data-name="task-monitor">Open approvals</button>
    `;
};

const wireCodeWorkspace = root => {
    let data = CODE_FALLBACK;
    let activeTab = 'File';
    const load = async () => {
        const [code, connections, capabilities, tools, monitor] = await Promise.all([
            mcpFetch('code', CODE_FALLBACK),
            mcpFetch('connections', {}),
            mcpFetch('capabilities', {}),
            mcpFetch('tools', {}),
            mcpFetch('task-monitor', {}),
        ]);
        data = normalizeCodeData({ code, connections, capabilities, tools, monitor });
        renderCodeWorkspace(root, data, activeTab);
    };
    root.querySelector('.ha-code-tabs').addEventListener('click', event => {
        const button = event.target.closest('[data-code-tab]');
        if ( ! button ) return;
        activeTab = button.dataset.codeTab;
        renderCodeWorkspace(root, data, activeTab);
    });
    root.querySelector('.ha-code-tree').addEventListener('click', event => {
        const button = event.target.closest('[data-code-file]');
        if ( ! button ) return;
        activeTab = 'File';
        data = { ...data, file: { path: button.dataset.codeFile, body: `${button.dataset.codeFile}\n\nLoaded through CODE MCP or demo fallback.`, status: 'Selected file' } };
        renderCodeWorkspace(root, data, activeTab);
    });
    load();
    return { load };
};

const renderJira = (root, data = JIRA_FALLBACK) => {
    const jiraConnection = data._connection || {};
    const jiraTools = data._tools || [];
    const jiraAudits = data.audits || [];
    const proposalTools = data._proposalTools || [];
    const proposals = data._proposals || [];
    const writePath = data._writePath || {};
    root.querySelector('.ha-jira-sidebar').innerHTML = `
        <h2>Projects</h2>
        ${asArray(data.projects).map(item => `<button type="button"><strong>${escapeHTML(item.key)}</strong><span>${escapeHTML(item.name)}${item.meta ? ` | ${escapeHTML(item.meta)}` : ''}</span></button>`).join('')}
        <h2>Boards</h2>
        ${asArray(data.boards).map(item => `<button type="button"><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.meta)}</span></button>`).join('')}
        <h2>MCP connection</h2>
        <div class="ha-agent-note">
            <strong>JIRA MCP</strong>
            <p>${escapeHTML(jiraConnection.status || 'Not connected')} • ${escapeHTML(jiraConnection.permission || '0/0 granted')}</p>
            <p>Approval mode: ${escapeHTML(jiraConnection.approval || 'read-only')}</p>
            <p>${jiraTools.filter(t => t.write).length} write tool${jiraTools.filter(t => t.write).length === 1 ? '' : 's'} gated</p>
        </div>
        <h2>Approval mode</h2>
        <div class="ha-agent-note">
            <strong>Write scope</strong>
            <p>jira:write — ${escapeHTML(jiraConnection.approval || 'read-only')}</p>
            <p>${jiraTools.length} tool${jiraTools.length === 1 ? '' : 's'} registered (${jiraTools.filter(t => t.write).length} write)</p>
        </div>
        <h2>Proposal write tools</h2>
        ${proposalTools.length
            ? proposalTools.map(item => `
                <div class="ha-agent-note">
                    <strong>${escapeHTML(item.name)}</strong>
                    <p>${escapeHTML(item.proposalDescription || 'Proposal write tool')}</p>
                    <span class="ha-pill warn">Proposal</span>
                </div>
            `).join('')
            : '<div class="ha-agent-note"><p>No proposal write tools registered.</p></div>'}
        <h2>Recent audit</h2>
        ${jiraAudits.length
            ? jiraAudits.slice(0, 4).map(item => `<div class="ha-agent-note"><strong>${escapeHTML(item.action)}</strong><p>${escapeHTML(item.target)} • ${escapeHTML(item.createdAt)}${item.id ? ` • ${escapeHTML(item.id)}` : ''}</p></div>`).join('')
            : '<div class="ha-agent-note"><p>No Jira audit events yet.</p></div>'}
    `;
    root.querySelector('.ha-jira-main').innerHTML = `
        ${renderAvailabilityPanel('Atlassian availability', data.availability || normalizeJiraAvailability(data, null, []))}
        <section class="ha-status-banner ${data.searchState?.available === false ? 'blocked' : 'neutral'}">
            <div>
                <strong>Search ${data.searchState?.available === false ? 'blocked' : 'available'}</strong>
                <p>${escapeHTML(data.searchState?.reason || 'Search payload status is unknown.')}</p>
            </div>
            <span class="ha-pill ${escapeHTML(data.searchState?.available === false ? 'bad' : 'neutral')}">${escapeHTML(data.searchState?.available === false ? 'Blocked' : 'Unknown')}</span>
        </section>
        ${writePath.mode === 'proposal' ? `
        <section class="ha-status-banner proposal">
            <div>
                <strong>Write path: proposal-and-approval</strong>
                <p>${escapeHTML(writePath.note || 'Jira write tools are first-class proposal-and-approval flows. No live Atlassian write is executed.')}</p>
            </div>
            <span class="ha-pill warn">${escapeHTML(`${writePath.proposalToolCount || proposalTools.length} proposal tools`)}</span>
        </section>
        ` : ''}
        ${data.evidenceState ? `
        <section class="ha-status-banner neutral">
            <div>
                <strong>Imported Jira evidence available</strong>
                <p>${escapeHTML(data.evidenceState.reason)}</p>
            </div>
            <span class="ha-pill good">Evidence</span>
        </section>
        ` : ''}
        <section>
            <h2>Issues</h2>
            ${renderRows(asArray(data.issues).map(item => ({ title: `${item.key} ${item.title}`, summary: item.assignee, status: item.status, statusTone: toneForState(item.status) })))}
        </section>
        <section>
            <h2>Imported Jira evidence</h2>
            ${data.issueEvidence?.issues?.length
                ? renderRows(asArray(data.issueEvidence.issues).map(item => ({
                    title: `${item.key} ${item.title}`,
                    summary: `${item.assignee || 'Unassigned'}${item.summary ? ` • ${item.summary}` : ''}`,
                    status: item.status,
                    statusTone: toneForState(item.status),
                })))
                : '<div class="ha-empty">No imported Jira issue evidence yet.</div>'}
            ${data.issueEvidence?.note ? `<p class="ha-inline-note">${escapeHTML(data.issueEvidence.note)}</p>` : ''}
        </section>
        <section class="ha-detail-panel">
            <h2>${escapeHTML(data.detail?.key)} ${escapeHTML(data.detail?.title)}</h2>
            <p>${escapeHTML(data.detail?.summary)}</p>
            <span class="ha-pill ${escapeHTML(toneForState(data.detail?.status))}">${escapeHTML(data.detail?.status)}</span>
        </section>
        <section class="ha-proposals-panel">
            <h2>Proposed Jira actions</h2>
            <p class="ha-proposals-note">${escapeHTML(writePath.note || 'No live Jira write is executed. Proposals are recorded in the audit log and require approval.')}</p>
            ${proposals.length
                ? proposals.map(item => `
                    <div class="ha-proposal-card">
                        <div class="ha-proposal-header">
                            <strong>${escapeHTML(item.toolName)}</strong>
                            <span class="ha-pill warn">Awaiting approval</span>
                        </div>
                        <p>${escapeHTML(item.description)}</p>
                        <div class="ha-proposal-meta">
                            <span>By: ${escapeHTML(item.actor)}</span>
                            <span>${escapeHTML(item.createdAt)}</span>
                            ${item.auditId ? `<span>Audit: ${escapeHTML(item.auditId)}</span>` : ''}
                        </div>
                    </div>
                `).join('')
                : '<div class="ha-empty">No Jira proposals submitted yet. Use the proposal write tools to propose Jira actions.</div>'}
        </section>
        <section class="ha-proposals-panel">
            <h2>Proposal write tools</h2>
            <p class="ha-proposals-note">These tools are first-class proposal-and-approval flows. No live Atlassian write is executed. Proposals require approval.</p>
            ${proposalTools.length
                ? proposalTools.map(item => `
                    <div class="ha-proposal-card">
                        <div class="ha-proposal-header">
                            <strong>${escapeHTML(item.name)}</strong>
                            <span class="ha-pill warn">Proposal</span>
                        </div>
                        <p>${escapeHTML(item.proposalDescription || item.description || 'Proposal write tool')}</p>
                    </div>
                `).join('')
                : '<div class="ha-empty">No proposal write tools registered.</div>'}
        </section>
        <section class="ha-split-panel">
            <div>
                <h2>Write approvals</h2>
                ${asArray(data.writeTools).length
                    ? asArray(data.writeTools).map(item => `
                        <div class="ha-agent-note">
                            <strong>${escapeHTML(item.name)}</strong>
                            <p>${escapeHTML(item.state)} • ${escapeHTML(item.detail)}</p>
                            ${item.approvalScope ? `<p>Scope: <span class="ha-pill warn">${escapeHTML(item.approvalScope)}</span></p>` : ''}
                            ${item.permissionDecision ? `<p>Decision: <span class="ha-pill ${escapeHTML(toneForState(item.permissionDecision))}">${escapeHTML(item.permissionDecision)}</span></p>` : ''}
                            ${item.auditId ? `<p>Audit: <span class="ha-pill neutral">${escapeHTML(item.auditId)}</span></p>` : ''}
                        </div>
                    `).join('')
                    : '<p>No Jira write tools reported.</p>'}
            </div>
            <div>
                <h2>Audit visibility</h2>
                ${asArray(data.audits).length
                    ? asArray(data.audits).map(item => `
                        <div class="ha-agent-note">
                            <strong>${escapeHTML(item.action)}</strong>
                            <p>${escapeHTML(item.target)} • ${escapeHTML(item.actor)} • ${escapeHTML(item.createdAt)}</p>
                            ${item.id ? `<p>Event: <span class="ha-pill neutral">${escapeHTML(item.id)}</span></p>` : ''}
                        </div>
                    `).join('')
                    : '<p>No Jira audit event reported yet.</p>'}
            </div>
        </section>
        <section class="ha-split-panel">
            <div><h2>Comments</h2>${asArray(data.comments).map(item => `<p><strong>${escapeHTML(item.author)}:</strong> ${escapeHTML(item.text)}</p>`).join('')}</div>
            <div><h2>Acceptance criteria</h2>${asArray(data.acceptanceCriteria).map(item => `<p>${escapeHTML(item)}</p>`).join('')}</div>
        </section>
    `;
};

const wireJira = root => {
    const load = async () => {
        const [jira, connections, tools, monitor, proposals] = await Promise.all([
            mcpFetch('jira', JIRA_FALLBACK),
            mcpFetch('connections', {}),
            mcpFetch('tools', {}),
            mcpFetch('task-monitor', {}),
            mcpFetch('proposals', { proposals: [], proposalTools: [] }),
        ]);
        const mergedTools = {
            ...tools,
            proposalTools: proposals?.proposalTools || tools?.proposalTools || [],
        };
        renderJira(root, normalizeJiraData({ jira, connections, tools: mergedTools, monitor }));
    };
    load();
    return { load };
};

const renderConfluence = (root, data = CONFLUENCE_FALLBACK) => {
    root.querySelector('.ha-confluence-sidebar').innerHTML = `
        <h2>Spaces</h2>
        ${asArray(data.spaces).map(item => `<button type="button"><strong>${escapeHTML(item.key)}</strong><span>${escapeHTML(item.name)} | ${escapeHTML(item.access)}</span></button>`).join('')}
        <h2>Recent</h2>
        ${asArray(data.recent).map(item => `<button type="button"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.status)} | ${escapeHTML(item.excerpt)}</span></button>`).join('')}
    `;
    root.querySelector('.ha-confluence-main').innerHTML = `
        ${renderAvailabilityPanel('Atlassian availability', data.availability || normalizeConfluenceAvailability(data, null, []))}
        <section class="ha-status-banner ${data.discoveryState?.available === false ? 'blocked' : 'neutral'}">
            <div>
                <strong>Discovery ${data.discoveryState?.available === false ? 'blocked' : 'available'}</strong>
                <p>${escapeHTML(data.discoveryState?.reason || 'Discovery payload status is unknown.')}</p>
            </div>
            <span class="ha-pill ${escapeHTML(data.discoveryState?.available === false ? 'bad' : 'neutral')}">${escapeHTML(data.discoveryState?.available === false ? 'Blocked' : 'Unknown')}</span>
        </section>
        <section>
            <div class="ha-toolbar compact"><input class="ha-search" value="" placeholder="Search Confluence via MCP" /></div>
            ${renderRows(asArray(data.search).map(item => ({ title: item.title, summary: item.excerpt, status: item.status || 'Search', statusTone: data.discoveryState?.available === false ? 'warn' : 'neutral' })))}
        </section>
        <section class="ha-detail-panel">
            <h2>${escapeHTML(data.viewer?.title)}</h2>
            <small>${escapeHTML(data.viewer?.space)}</small>
            <p>${escapeHTML(data.viewer?.body)}</p>
        </section>
        <section class="ha-split-panel">
            <div>
                <h2>Write approvals</h2>
                ${asArray(data.writeTools).length
                    ? asArray(data.writeTools).map(item => `
                        <div class="ha-agent-note">
                            <strong>${escapeHTML(item.name)}</strong>
                            <p>${escapeHTML(item.state)} • ${escapeHTML(item.detail)}</p>
                            ${item.approvalScope ? `<p>Scope: <span class="ha-pill warn">${escapeHTML(item.approvalScope)}</span></p>` : ''}
                            ${item.permissionDecision ? `<p>Decision: <span class="ha-pill ${escapeHTML(toneForState(item.permissionDecision))}">${escapeHTML(item.permissionDecision)}</span></p>` : ''}
                            ${item.auditId ? `<p>Audit: <span class="ha-pill neutral">${escapeHTML(item.auditId)}</span></p>` : ''}
                        </div>
                    `).join('')
                    : '<p>No Confluence write tools reported.</p>'}
            </div>
            <div>
                <h2>Audit visibility</h2>
                ${asArray(data.audits).length
                    ? asArray(data.audits).map(item => `
                        <div class="ha-agent-note">
                            <strong>${escapeHTML(item.action)}</strong>
                            <p>${escapeHTML(item.target)} • ${escapeHTML(item.actor)} • ${escapeHTML(item.createdAt)}</p>
                            ${item.id ? `<p>Event: <span class="ha-pill neutral">${escapeHTML(item.id)}</span></p>` : ''}
                        </div>
                    `).join('')
                    : '<p>No Confluence audit event reported yet.</p>'}
            </div>
        </section>
        <section class="ha-detail-panel">
            <h2>Ask</h2>
            ${asArray(data.ask).map(item => `<p><strong>${escapeHTML(item.question)}</strong><br>${escapeHTML(item.answer)}</p>`).join('')}
        </section>
    `;
};

const wireConfluence = root => {
    const load = async () => {
        const [confluence, connections, tools, monitor] = await Promise.all([
            mcpFetch('confluence', CONFLUENCE_FALLBACK),
            mcpFetch('connections', {}),
            mcpFetch('tools', {}),
            mcpFetch('task-monitor', {}),
        ]);
        renderConfluence(root, normalizeConfluenceData({ confluence, connections, tools, monitor }));
    };
    load();
    return { load };
};

const postAgentCommand = async (message, history) => {
    const fallback = 'Demo fallback: MCP task monitor checked permissions, approval state, and observe log.';
    const data = await mcpFetch('task-monitor', { reply: fallback }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(-8) }),
    });
    return data.reply || data.message || fallback;
};

const wireChat = root => {
    const messages = root.querySelector('.ha-messages');
    const form = root.querySelector('.ha-chat-form');
    const input = form.querySelector('input');
    let history = [];

    const add = (text, type = 'agent') => {
        history.push({ text, type });
        const node = document.createElement('div');
        node.className = `ha-msg ${type}`;
        node.innerHTML = `<span>${escapeHTML(text)}</span><small>${time()}</small>`;
        messages.append(node);
        messages.scrollTop = messages.scrollHeight;
    };

    const send = async value => {
        const message = value.trim();
        if ( ! message ) return;
        add(message, 'user');
        input.value = '';
        add(await postAgentCommand(message, history), 'agent');
    };

    form.addEventListener('submit', event => {
        event.preventDefault();
        send(input.value);
    });
    root.querySelectorAll('[data-command]').forEach(button => {
        button.addEventListener('click', () => send(button.dataset.command));
    });
    root.querySelector('[data-chat-reset]').addEventListener('click', () => {
        history = [];
        messages.innerHTML = '';
        add('Agent Console ready. Commands route through MCP task monitor.');
    });
    root.addEventListener('havas-agentic-selection', event => {
        add(`Selected ${event.detail}. MCP state and approvals remain visible in Task Monitor.`, 'agent');
    });
    add('Agent Console ready. Commands route through MCP task monitor.');
};

const launchNativeSurface = async slug => {
    try {
        if ( slug === 'settings' ) {
            UIWindowSettings();
            return;
        }
        if ( slug === 'explorer' || slug === 'documents' || slug === 'presentations' ) {
            await launch_app({
                name: 'explorer',
                path: slug === 'explorer' ? window.home_path : (window.docs_path || window.documents_path || window.home_path),
                window_options: { left: 260, top: 96, width: 820, height: 560 },
            });
            return;
        }
        if ( slug === 'editor' ) {
            await launch_app({ name: slug, window_options: { left: 280, top: 108, width: 860, height: 580 } });
        }
    } catch ( error ) {
        console.warn('Native surface unavailable', slug, error);
    }
};

const wirePalette = (root, openSurface) => {
    const palette = root.querySelector('.ha-palette');
    const input = root.querySelector('.ha-palette-input');
    const results = root.querySelector('.ha-palette-results');
    let mode = 'command';
    let items = COMMAND_FALLBACK;

    const close = () => {
        palette.hidden = true;
        input.value = '';
    };

    const run = item => {
        if ( item.type === 'section' ) openSurface(item.target);
        else if ( item.target ) openSurface(item.target);
        else if ( item.path ) openSurface('code-workspace');
        close();
    };

    const render = () => {
        const query = input.value.trim().toLowerCase();
        const filtered = items.filter(item => Object.values(item).join(' ').toLowerCase().includes(query));
        results.innerHTML = (filtered.length ? filtered : items).slice(0, 12).map((item, index) => `
            <button type="button" data-palette-index="${index}">
                <strong>${escapeHTML(item.title || item.path)}</strong>
                <span>${escapeHTML(item.subtitle || item.type || item.status || 'file')}</span>
            </button>
        `).join('');
    };

    const open = async nextMode => {
        mode = nextMode;
        if ( mode === 'file' ) {
            const code = await mcpFetch('code', CODE_FALLBACK);
            items = asArray(code.files).map(file => ({ ...file, title: file.path, type: 'file' }));
            input.placeholder = 'Open file via CODE MCP';
        } else {
            const [commands, tools, approvals, monitor] = await Promise.all([
                mcpFetch('commands', COMMAND_FALLBACK),
                mcpFetch('tools', {}),
                mcpFetch('connections', {}),
                mcpFetch('task-monitor', { approvals: MCP_FALLBACK.approvals }),
            ]);
            const jiraProposals = monitor?.jiraProposals || { proposals: [], writePath: { mode: 'proposal' } };
            items = normalizeCommandItems({ commands, tools, approvals, jiraProposals });
            input.placeholder = 'Run command';
        }
        palette.hidden = false;
        render();
        input.focus();
    };

    input.addEventListener('input', render);
    results.addEventListener('click', event => {
        const button = event.target.closest('[data-palette-index]');
        if ( ! button ) return;
        const current = Array.from(results.querySelectorAll('button'));
        const index = current.indexOf(button);
        const query = input.value.trim().toLowerCase();
        const filtered = items.filter(item => Object.values(item).join(' ').toLowerCase().includes(query));
        run((filtered.length ? filtered : items)[index]);
    });
    input.addEventListener('keydown', event => {
        if ( event.key === 'Escape' ) close();
        if ( event.key === 'Enter' ) {
            const query = input.value.trim().toLowerCase();
            const filtered = items.filter(item => Object.values(item).join(' ').toLowerCase().includes(query));
            run((filtered.length ? filtered : items)[0]);
        }
    });
    palette.addEventListener('click', event => {
        if ( event.target === palette ) close();
    });
    document.addEventListener('keydown', event => {
        const shortcut = event.metaKey || event.ctrlKey;
        if ( ! shortcut ) return;
        if ( event.key.toLowerCase() === 'k' ) {
            event.preventDefault();
            open('command');
        }
        if ( event.key.toLowerCase() === 'p' ) {
            event.preventDefault();
            open('file');
        }
    });
};

const UICXOSDesktop = () => {
    if ( document.querySelector('.cxos-desktop') ) return;

    let style = document.getElementById('havas-agentic-os-styles');
    if ( ! style ) {
        style = document.createElement('style');
        style.id = 'havas-agentic-os-styles';
        style.textContent = agenticOSStyles;
        document.head.append(style);
    }

    const root = document.createElement('div');
    root.className = 'cxos-desktop havas-agentic-os';
    root.innerHTML = createMarkup();
    (document.querySelector('.desktop') || document.body).append(root);

    const os = wireAgenticOS(root);
    const integrations = {
        'mcp-connections': wireMCPConnections(root),
        'code-workspace': wireCodeWorkspace(root),
        jira: wireJira(root),
        confluence: wireConfluence(root),
    };

    const openSurface = slug => {
        if ( PRODUCT_SLUGS.has(slug) ) {
            os.openSection(APP_SECTIONS[slug] || DEFAULT_SECTION);
            return;
        }
        if ( MCP_WINDOWS.has(slug) ) {
            const target = root.querySelector(`[data-window="${slug}"]`);
            target?.classList.add('open');
            integrations[slug]?.load?.();
            return;
        }
        if ( NATIVE_SLUGS.has(slug) || slug === 'settings-native' ) {
            launchNativeSurface(slug === 'settings-native' ? 'settings' : slug);
            return;
        }
        root.dispatchEvent(new CustomEvent('havas-agentic-selection', { detail: APP_BY_NAME.get(slug)?.title || DEFAULT_AGENT }));
    };

    wireChat(root);
    wirePalette(root, openSurface);

    root.addEventListener('click', event => {
        const appButton = event.target.closest('[data-name]');
        if ( appButton ) {
            event.preventDefault();
            event.stopPropagation();
            openSurface(appButton.dataset.name);
            return;
        }
        const closeButton = event.target.closest('[data-window-close]');
        if ( closeButton ) {
            root.querySelector(`[data-window="${closeButton.dataset.windowClose}"]`)?.classList.remove('open');
            return;
        }
        const refreshButton = event.target.closest('[data-window-refresh]');
        if ( refreshButton ) integrations[refreshButton.dataset.windowRefresh]?.load?.();
    });
};

export default UICXOSDesktop;
