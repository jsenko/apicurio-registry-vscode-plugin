'use strict';

import * as vscode from 'vscode';
import { Search, SearchEntry } from './interfaces';
import { ApicurioTools } from './tools';
import * as mime from 'mime-types';
import { Services } from './services';

namespace _ {
    export const tools = new ApicurioTools();
}

/**
 * Apicurio Explorer Provider
 */

export class ApicurioExplorerProvider implements vscode.TreeDataProvider<SearchEntry> {
    private readonly extensionUri: any;

    private readonly onDidChangeTreeDataEmitter: vscode.EventEmitter<void>;
    readonly onDidChangeTreeData: vscode.Event<void>;

    private currentSearch: Search;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;

        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter<any>();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

        this.currentSearch = { property: '', propertyValue: '' };
    }

    public refresh(search?: Search): any {
        this.currentSearch = search ? search : { property: '', propertyValue: '' };
        this.onDidChangeTreeDataEmitter.fire();
    }

    // Get Groups

    private getGroups(): Promise<string[]> {
        return Services.get().getRegistryClient().getGroups();
    }

    // Read Directory

    private async readDirectory(groupId: string): Promise<SearchEntry[]> {
        const searchParam = {};
        // Manage search parameters
        if (this.currentSearch.property) {
            searchParam[this.currentSearch.property] = this.currentSearch.propertyValue;
        }
        if (groupId) {
            searchParam['group'] = groupId;
        }

        // Manage request
        const children = await Services.get().getRegistryClient().searchArtifacts(searchParam);
        const result: SearchEntry[] = [];
        const currentGroup: string[] = [];
        for (let i = 0; i < children.artifacts.length; i++) {
            // Manage parents
            if (!groupId && currentGroup.includes(children.artifacts[i].groupId)) {
                continue;
            }
            currentGroup.push(children.artifacts[i].groupId);
            // for all items
            // Manage custom searches (not available on Apicurio API)
            if (
                this.currentSearch.property == 'type' &&
                this.currentSearch.propertyValue != children.artifacts[i].type
            ) {
                continue;
            }
            if (
                this.currentSearch.property == 'state' &&
                this.currentSearch.propertyValue != children.artifacts[i].state
            ) {
                continue;
            }
            const child: SearchEntry = {
                groupId: children.artifacts[i].groupId,
                id: children.artifacts[i].id,
                name: children.artifacts[i].name,
                description: children.artifacts[i].description,
                type: children.artifacts[i].type,
                state: children.artifacts[i].state,
                parent: !groupId,
            };
            result.push(child);
        }
        // Return empty result
        if (result.length == 0) {
            const isEmpty: SearchEntry = {
                groupId: 'No content',
                id: '',
                name: '',
                description: '',
                type: '',
                state: '',
                parent: true,
            };
            return Promise.resolve([isEmpty]);
        }
        // Sort result, as the API do not allow sort by Group or ID but only by name or update date
        result.sort(function (a, b) {
            const nameA = a.groupId.toLowerCase() + a.id.toLowerCase(); // ignore upper and lowercase
            const nameB = b.groupId.toLowerCase() + b.id.toLowerCase(); // ignore upper and lowercase
            if (nameA < nameB) {
                return -1;
            }
            if (nameA > nameB) {
                return 1;
            }
            // names must be equal
            return 0;
        });

        return Promise.resolve(result);
    }

    // custom command

    refreshChildViews(element: SearchEntry) {
        vscode.commands.executeCommand('apicurioVersionsExplorer.getChildren', element);
        vscode.commands.executeCommand('apicurioMetasExplorer.getChildren', element);
    }

    // Add artifact

    async addArtifact() {
        const existingGroup = await vscode.window.showQuickPick(_.tools.getLists('add'), {
            title: 'New or existing group ?',
        });
        let groupId = '';
        if (existingGroup == 'NEW') {
            groupId = await vscode.window.showInputBox({
                title: 'Create a new Group ID',
            });
            const confirmGroupId = await vscode.window.showInputBox({
                title: 'Confirm new Group ID',
            });
            if (groupId != confirmGroupId) {
                vscode.window.showErrorMessage('Group ID did not match with confirmation.');
                return Promise.resolve();
            }
        }
        if (existingGroup == 'EXISTING') {
            const groups = this.getGroups();
            groupId = await vscode.window.showQuickPick(groups, {
                title: 'Choose group :',
            });
            // Confirm box
            const confirm = await vscode.window.showQuickPick(_.tools.getLists('confirm'), {
                title: `Do you want to use group : '${groupId}'`,
                canPickMany: false,
            });
            if (confirm != 'yes') {
                return Promise.resolve();
            }
        }
        if (!groupId || groupId == '') {
            vscode.window.showErrorMessage('No group defined.');
            return Promise.resolve();
        }
        const artifactType = await vscode.window.showQuickPick(_.tools.getLists('types'), {
            title: 'Choose an artifact type to push :',
        });
        if (!artifactType) {
            vscode.window.showErrorMessage('No defined type.');
            return Promise.resolve();
        }
        const artifactId = await vscode.window.showInputBox({
            title: 'Artifact ID',
        });
        if (!artifactId) {
            vscode.window.showErrorMessage('No defined artifact ID.');
            return Promise.resolve();
        }
        const version = await vscode.window.showInputBox({
            title: 'Initial version',
            placeHolder: '1.0.0',
        });
        if (!version) {
            vscode.window.showErrorMessage('No defined version.');
            return Promise.resolve();
        }
        const searchQuery = await vscode.window.showInputBox({
            title: 'Search for file :',
            placeHolder: '**/*.json',
        });
        const finds: any = await vscode.workspace.findFiles(searchQuery);
        const elements: string[] = [];
        for (const i in finds) {
            if (finds[i].scheme == 'file') {
                elements.push(finds[i].path);
            }
        }
        const currentFile = await vscode.window.showQuickPick(elements, {
            title: 'Select file :',
        });
        if (currentFile == undefined) {
            vscode.window.showErrorMessage('No selected files.');
            return Promise.resolve();
        }
        const fileBody = await vscode.workspace.fs.readFile(vscode.Uri.file(currentFile));
        if (fileBody == undefined) {
            vscode.window.showErrorMessage(`Unnable to load the file '${currentFile}'.`);
            return Promise.resolve();
        }
        const body = fileBody.toString();

        // Confirm box
        const confirm = await vscode.window.showQuickPick(_.tools.getLists('confirm'), {
            title: `Create ${artifactType} artifact with identifiers '${groupId}:${artifactId}:${version}' ?`,
            canPickMany: false,
        });
        if (confirm != 'yes') {
            return Promise.resolve();
        }
        const path = _.tools.getQueryPath({ id: null, group: groupId }, 'group', {
            ifExists: 'FAIL',
        });
        const mimeType = mime.lookup(currentFile);
        const headers = {
            'X-Registry-Version': version,
            'X-Registry-ArtifactId': artifactId,
            'X-Registry-ArtifactType': artifactType,
            'Content-Type': mimeType,
        };
        await _.tools.query(path, 'POST', body, headers);
        // Refresh view to display version.
        this.onDidChangeTreeDataEmitter.fire();
    }

    // Search

    async search() {
        const title = 'Apicurio Search Artifact By';
        const option = await vscode.window.showQuickPick(_.tools.getLists('search'), {
            title: `${title}`,
            canPickMany: false,
        });
        let search: string;
        switch (option) {
            case 'type':
                search = await vscode.window.showQuickPick(_.tools.getLists('types'), {
                    title: `${title} ${option}`,
                    canPickMany: false,
                });
                break;
            case 'state':
                search = await vscode.window.showQuickPick(_.tools.getLists('states'), {
                    title: `${title} ${option}`,
                    canPickMany: false,
                });
                break;
            default:
                search = await vscode.window.showInputBox({
                    title: `${title} ${option}`,
                });
                break;
        }
        const searchRequest: Search = { property: option, propertyValue: search };
        return this.refresh(searchRequest);
    }

    // tree data provider

    async getChildren(element?: SearchEntry): Promise<SearchEntry[]> {
        const children: SearchEntry[] = await this.readDirectory(element ? element.groupId : '');
        return Promise.resolve(children);
    }

    getTreeItem(element: SearchEntry): vscode.TreeItem {
        if (element.parent) {
            // Manage display of empty results (not collapsible).
            return new vscode.TreeItem(
                element.groupId,
                element.id ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
            );
        }
        const displayName = vscode.workspace.getConfiguration('apicurio.explorer').get('name');
        const name = !displayName || !element.name ? element.id : element.name;
        const tooltip = !displayName && element.name ? element.name : element.id;
        const treeItem = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None); // None / Collapsed
        treeItem.command = {
            command: 'apicurioExplorer.refreshChildViews',
            title: 'Display artifact versions',
            arguments: [element],
        };
        treeItem.description = element.state.toLowerCase();
        treeItem.tooltip = tooltip;
        // treeItem.iconPath = new vscode.ThemeIcon('key');
        treeItem.iconPath = {
            dark: vscode.Uri.joinPath(this.extensionUri, 'resources', 'dark', element.type.toLowerCase() + '.svg'),
            light: vscode.Uri.joinPath(this.extensionUri, 'resources', 'light', element.type.toLowerCase() + '.svg'),
        };
        return treeItem;
    }
}

export class ApicurioExplorer {
    constructor(context: vscode.ExtensionContext) {
        const treeDataProvider = new ApicurioExplorerProvider(context.extensionUri);
        context.subscriptions.push(
            vscode.window.createTreeView('apicurioExplorer', {
                treeDataProvider,
                showCollapseAll: true,
            })
        );
        vscode.commands.registerCommand('apicurioExplorer.refreshChildViews', (element) =>
            treeDataProvider.refreshChildViews(element)
        );
        vscode.commands.registerCommand('apicurioExplorer.refreshEntry', () => treeDataProvider.refresh());
        vscode.commands.registerCommand('apicurioExplorer.search', () => treeDataProvider.search());
        vscode.commands.registerCommand('apicurioExplorer.addArtifact', () => treeDataProvider.addArtifact());

        //vscode.commands.registerCommand('apicurioExplorer.test', () => Services.get().test());
    }
}
