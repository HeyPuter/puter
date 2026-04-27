export interface JiraIssueTypeEvidence {
    id: string;
    name: string;
    subtask: boolean;
    hierarchyLevel: number;
}

export interface JiraProjectEvidence {
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
    simplified: boolean;
    style: string;
    isPrivate: boolean;
    entityId: string;
    issueTypes: JiraIssueTypeEvidence[];
}

export interface JiraRecentIssueEvidence {
    id: string;
    key: string;
    summary: string;
    status: string;
    priority: string;
    assignee: string | null;
    webUrl: string;
}

export interface JiraImportedEvidence {
    cloudId: string;
    site: string;
    importedAt: string;
    source: 'atlassian-rovo-mcp';
    evidenceOnly: true;
    note: string;
    projects: JiraProjectEvidence[];
    recentIssues: JiraRecentIssueEvidence[];
}

const importedEvidence: JiraImportedEvidence = {
    cloudId: 'f076a948-b3ae-4495-8f1a-62a4418c1752',
    site: 'waltzai.atlassian.net',
    importedAt: '2026-04-27T00:00:00.000Z',
    source: 'atlassian-rovo-mcp',
    evidenceOnly: true,
    note: 'Operator-verified Atlassian MCP evidence imported during development. This backend service does not fetch live Jira project state.',
    projects: [
        {
            id: '10000',
            key: 'SCRUM',
            name: 'My Team',
            projectTypeKey: 'software',
            simplified: true,
            style: 'next-gen',
            isPrivate: false,
            entityId: '518bfdf2-d0a7-47b9-8346-88b139647c1d',
            issueTypes: [
                { id: '10001', name: 'Epik', subtask: false, hierarchyLevel: 1 },
                { id: '10002', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
                { id: '10003', name: 'Gorev', subtask: false, hierarchyLevel: 0 },
            ],
        },
        {
            id: '10033',
            key: 'TES',
            name: 'Teserract',
            projectTypeKey: 'software',
            simplified: true,
            style: 'next-gen',
            isPrivate: false,
            entityId: '26dffc0f-e595-4de3-94b9-8ab7c61cd816',
            issueTypes: [
                { id: '10037', name: 'Gorev', subtask: false, hierarchyLevel: 0 },
                { id: '10038', name: 'Hata', subtask: false, hierarchyLevel: 0 },
                { id: '10039', name: 'Hikaye', subtask: false, hierarchyLevel: 0 },
                { id: '10040', name: 'Epik', subtask: false, hierarchyLevel: 1 },
                { id: '10041', name: 'Alt gorev', subtask: true, hierarchyLevel: -1 },
            ],
        },
    ],
    recentIssues: [
        {
            id: '10632',
            key: 'TES-99',
            summary: 'Document Telegram operator and autopilot operations',
            status: 'Tamam',
            priority: 'Medium',
            assignee: null,
            webUrl: 'https://waltzai.atlassian.net/browse/TES-99',
        },
        {
            id: '10631',
            key: 'TES-98',
            summary: 'Pythia typecheck debt cleanup',
            status: 'Tamam',
            priority: 'Medium',
            assignee: null,
            webUrl: 'https://waltzai.atlassian.net/browse/TES-98',
        },
        {
            id: '10630',
            key: 'TES-97',
            summary: 'Hermes Telegram webhook callback update coverage',
            status: 'Tamam',
            priority: 'Medium',
            assignee: null,
            webUrl: 'https://waltzai.atlassian.net/browse/TES-97',
        },
        {
            id: '10629',
            key: 'TES-96',
            summary: 'Hermes-Pythia deploy callback parity for Telegram inline actions',
            status: 'Tamam',
            priority: 'Medium',
            assignee: null,
            webUrl: 'https://waltzai.atlassian.net/browse/TES-96',
        },
        {
            id: '10628',
            key: 'TES-95',
            summary: 'Pythia Telegram polling split-brain shutdown',
            status: 'Tamam',
            priority: 'Medium',
            assignee: null,
            webUrl: 'https://waltzai.atlassian.net/browse/TES-95',
        },
    ],
};

export const getImportedJiraEvidence = (): JiraImportedEvidence => ({
    ...importedEvidence,
    projects: importedEvidence.projects.map(project => ({
        ...project,
        issueTypes: project.issueTypes.map(issueType => ({ ...issueType })),
    })),
    recentIssues: importedEvidence.recentIssues.map(issue => ({ ...issue })),
});

export const jiraEvidenceAvailability = () => ({
    backendFetchAvailable: false,
    projectCatalogAvailable: false,
    issueDiscoveryAvailable: false,
    writeAvailable: false,
    evidenceAvailable: true,
    blockedReason: 'The backend service has no live Atlassian MCP bridge for Jira project reads, issue discovery, or Jira writes. Only imported operator-verified MCP evidence is available.',
});
