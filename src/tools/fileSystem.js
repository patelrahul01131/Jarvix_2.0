let vscode;
try {
  vscode = require("vscode");
} catch (e) {
  vscode = {
    window: { activeTextEditor: null },
    workspace: { workspaceFolders: null },
  };
}
const fs = require("fs");
const path = require("path");

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

function getLanguageFromExt(ext) {
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript',
    tsx: 'typescript', py: 'python', html: 'html', css: 'css',
    json: 'json', md: 'markdown', java: 'java', cpp: 'cpp',
    c: 'c', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
    sh: 'bash', yaml: 'yaml', yml: 'yaml', xml: 'xml'
  };
  return map[ext] || ext;
}

// Legacy File Reader functions 
function listWorkspaceFiles() {
  const root = getWorkspaceRoot();
  if (!root) return [];
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next',
                  'out', 'coverage', '.cache', 'vendor', '__pycache__', '.jarvix'];

  function walk(dir, maxFiles = 10000) {
    let files = [];
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (files.length >= maxFiles) break;
        if (ignore.includes(item)) continue;
        const fullPath = path.join(dir, item);
        const relative = path.relative(root, fullPath);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          files.push({ type: 'dir', path: relative, name: item });
          files = files.concat(walk(fullPath, maxFiles - files.length));
        } else {
          files.push({ type: 'file', path: relative, name: item });
        }
      }
    } catch (e) {}
    return files;
  }

  return walk(root);
}

function readFileFromWorkspace(filePath) {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace folder open.');
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
  
  if (!fullPath.toLowerCase().startsWith(path.resolve(root).toLowerCase())) {
    throw new Error('Security Violation: Cannot access files outside the workspace directory.');
  }

  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
  const code = fs.readFileSync(fullPath, 'utf8');
  const ext = path.extname(fullPath).slice(1);
  return {
    code,
    selectedCode: null,
    language: getLanguageFromExt(ext),
    filename: fullPath,
    relativePath: path.relative(root, fullPath),
    lineCount: code.split('\n').length
  };
}

function writeFileToWorkspace(filePath, content) {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace folder open.');
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
  
  if (!fullPath.toLowerCase().startsWith(path.resolve(root).toLowerCase())) {
    throw new Error('Security Violation: Cannot write files outside the workspace directory.');
  }

  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function fileExistsInWorkspace(filePath) {
  const root = getWorkspaceRoot();
  if (!root) return false;
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
    
  if (!fullPath.toLowerCase().startsWith(path.resolve(root).toLowerCase())) {
    return false;
  }
  
  return fs.existsSync(fullPath);
}

function deleteFileFromWorkspace(filePath) {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace folder open.');
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
    
  if (!fullPath.toLowerCase().startsWith(path.resolve(root).toLowerCase())) {
    throw new Error('Security Violation: Cannot delete files outside the workspace directory.');
  }
  
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    return true;
  }
  return false;
}

// --- NEW STRUCTURED TOOL API (Execution Engine Compatible) ---

function executeReadFile(params) {
  try {
    const res = readFileFromWorkspace(params.filePath);
    return { success: true, stdout: res.code, stderr: "", exitCode: 0 };
  } catch (err) {
    return { success: false, stdout: "", stderr: err.message, exitCode: 1 };
  }
}

function executeWriteFile(params) {
  try {
    const writtenPath = writeFileToWorkspace(params.filePath, params.code);
    return { success: true, stdout: `Successfully wrote to ${writtenPath}`, stderr: "", exitCode: 0 };
  } catch (err) {
    return { success: false, stdout: "", stderr: err.message, exitCode: 1 };
  }
}

module.exports = {
  getWorkspaceRoot,
  listWorkspaceFiles,
  readFileFromWorkspace,
  writeFileToWorkspace,
  fileExistsInWorkspace,
  deleteFileFromWorkspace,
  getLanguageFromExt,
  executeReadFile,
  executeWriteFile
};
