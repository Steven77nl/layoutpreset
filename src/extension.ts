import * as vscode from 'vscode';

type PanelPosition = 'bottom' | 'left' | 'right';
type SidebarPosition = 'left' | 'right';

interface LayoutPreset {
  name: string;
  timestamp: number;
  panel: {
    position: PanelPosition;
    sizePx?: number;
    visible: boolean;
  };
  sidebar: {
    position: SidebarPosition;
    sizePx?: number;
    visible: boolean;
  };
}

const STORAGE_KEY = 'layoutPresets.v1';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('layoutPreset.savePreset', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Preset name' });
      if (!name) {
        vscode.window.showInformationMessage('Preset save cancelled.');
        return;
      }
      const preset = await captureCurrentLayout(name);
      const list = getPresets(context);
      list.push(preset);
      await context.globalState.update(STORAGE_KEY, list);
      vscode.window.showInformationMessage(`Saved layout preset "${name}".`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('layoutPreset.listPresets', async () => {
      const list = getPresets(context);
      if (list.length === 0) {
        vscode.window.showInformationMessage('No layout presets saved.');
        return;
      }
      const items = list.map(p => ({ label: p.name, description: new Date(p.timestamp).toLocaleString() }));
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Saved layout presets' });
      if (!pick) { return; }
      vscode.window.showInformationMessage(`Preset: ${pick.label}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('layoutPreset.applyPreset', async () => {
      const list = getPresets(context);
      if (list.length === 0) {
        vscode.window.showInformationMessage('No layout presets saved.');
        return;
      }
      const items = list.map(p => ({ label: p.name, description: new Date(p.timestamp).toLocaleString(), preset: p }));
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a layout preset to apply' }) as any;
      if (!pick) { return; }
      await applyPreset(pick.preset);
      vscode.window.showInformationMessage(`Applied layout preset "${pick.label}".`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('layoutPreset.deletePreset', async () => {
      const list = getPresets(context);
      if (list.length === 0) {
        vscode.window.showInformationMessage('No layout presets saved.');
        return;
      }
      const items = list.map((p, idx) => ({ label: p.name, description: new Date(p.timestamp).toLocaleString(), idx }));
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a layout preset to delete' }) as any;
      if (!pick) { return; }
      list.splice(pick.idx, 1);
      await context.globalState.update(STORAGE_KEY, list);
      vscode.window.showInformationMessage(`Deleted preset "${pick.label}".`);
    })
  );
}

function getPresets(context: vscode.ExtensionContext): LayoutPreset[] {
  const raw = context.globalState.get<LayoutPreset[]>(STORAGE_KEY);
  return raw ? raw : [];
}

/**
 * Capture current layout state.
 *
 * Note: VS Code does not expose pixel-precise sizes for panels and sidebar.
 * This function therefore captures positions and visibility, and leaves sizePx unset.
 * sizePx can be filled manually by the user later or approximated in future updates.
 */
async function captureCurrentLayout(name: string): Promise<LayoutPreset> {
  // Detect sidebar position (left or right)
  const sidebarPosition = getConfig<'left' | 'right'>('workbench.sideBar.location', 'left');
  const sidebarVisible = isSidebarVisible();
  // Detect panel position - VS Code stores panel location in workbench.panel.defaultLocation in some versions
  const panelPosition = getPanelPosition();
  const panelVisible = isPanelVisible();

  const preset: LayoutPreset = {
    name,
    timestamp: Date.now(),
    sidebar: {
      position: sidebarPosition === 'right' ? 'right' : 'left',
      visible: sidebarVisible,
    },
    panel: {
      position: panelPosition,
      visible: panelVisible,
    }
  };

  return preset;
}

async function applyPreset(p: LayoutPreset): Promise<void> {
  // Apply sidebar position
  const currentSidebar = getConfig<'left' | 'right'>('workbench.sideBar.location', 'left');
  if (p.sidebar.position !== currentSidebar) {
    // Toggle sidebar position command
    await vscode.commands.executeCommand('workbench.action.toggleSidebarPosition');
  }

  // Apply sidebar visibility
  const sidebarVisibleNow = isSidebarVisible();
  if (p.sidebar.visible !== sidebarVisibleNow) {
    await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
  }

  // Apply panel position
  const panelPosNow = getPanelPosition();
  if (p.panel.position !== panelPosNow) {
    // Move panel to desired location.
    // VS Code provides commands: workbench.action.togglePanel and workbench.action.toggleSidebarPosition is the only toggle;
    // For moving panel to right/left, use view.toggle to move terminal or panel via commands:
    if (p.panel.position === 'bottom') {
      await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    } else if (p.panel.position === 'right') {
      await vscode.commands.executeCommand('workbench.action.positionPanelRight');
    } else {
      await vscode.commands.executeCommand('workbench.action.positionPanelLeft');
    }
  }

  // Apply panel visibility
  const panelVisibleNow = isPanelVisible();
  if (p.panel.visible !== panelVisibleNow) {
    await vscode.commands.executeCommand('workbench.action.togglePanel');
  }

  // Note: VS Code API does not allow setting exact pixel sizes. We can attempt best-effort adjustments
  // using available commands (increase/decrease view size) in future improvements.
}

/**
 * Helper to read configuration with a fallback.
 */
function getConfig<T>(key: string, fallback: T): T {
  const cfg = vscode.workspace.getConfiguration();
  const val = cfg.get<T>(key);
  return (val === undefined ? fallback : val);
}

/**
 * Best-effort check if sidebar is visible.
 *
 * Note: VS Code does not expose a reliable API to detect sidebar visibility.
 * Return a conservative default (true). In the future we could try heuristics
 * (e.g. tracking commands that toggle the sidebar) or store visibility when saving presets.
 */
function isSidebarVisible(): boolean {
  return true;
}

/**
 * Best-effort check if panel is visible.
 */
function isPanelVisible(): boolean {
  // No reliable API to detect panel visibility; we assume visible if the panel has focus.
  const active = vscode.window.activeTerminal || vscode.window.activeTextEditor;
  // This is a heuristic; default to true.
  return true;
}

/**
 * Read stored panel position if available from settings, default to 'bottom'.
 */
function getPanelPosition(): PanelPosition {
  // Some VS Code versions have 'workbench.panel.defaultLocation'
  const cfg = vscode.workspace.getConfiguration();
  const pos = cfg.get<string>('workbench.panel.defaultLocation') || cfg.get<string>('workbench.panel.location');
  if (pos === 'left' || pos === 'right') {
    return pos === 'left' ? 'left' : 'right';
  }
  return 'bottom';
}

export function deactivate() {
  // noop
}
