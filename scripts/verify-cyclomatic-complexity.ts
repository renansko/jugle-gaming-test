import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const MAX_COMPLEXITY = 6;

interface ComplexityViolation {
  file: string;
  line: number;
  name: string;
  complexity: number;
}

function getLineAndCharacter(sourceFile: ts.SourceFile, pos: number): { line: number; character: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: line + 1, character: character + 1 };
}

function getNodeName(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isMethodDeclaration(node) && node.name) {
    return node.name.getText(sourceFile);
  }
  if (ts.isGetAccessor(node) && node.name) {
    return `get ${node.name.getText(sourceFile)}`;
  }
  if (ts.isSetAccessor(node) && node.name) {
    return `set ${node.name.getText(sourceFile)}`;
  }
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (ts.isVariableDeclaration(node.parent) && node.parent.name) {
    return node.parent.name.getText(sourceFile);
  }
  if (ts.isPropertyDeclaration(node.parent) && node.parent.name) {
    return node.parent.name.getText(sourceFile);
  }
  return "<anonymous>";
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function calculateComplexity(fnNode: ts.Node): number {
  let complexity = 1;

  function visit(node: ts.Node): void {
    if (node !== fnNode && isFunctionLike(node)) {
      return;
    }

    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
        complexity += 1;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const binExpr = node as ts.BinaryExpression;
        const op = binExpr.operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken
        ) {
          complexity += 1;
        }
        break;
      }
      default:
        break;
    }

    ts.forEachChild(node, visit);
  }

  if (
    ts.isArrowFunction(fnNode) ||
    ts.isFunctionExpression(fnNode) ||
    ts.isFunctionDeclaration(fnNode) ||
    ts.isMethodDeclaration(fnNode) ||
    ts.isConstructorDeclaration(fnNode) ||
    ts.isGetAccessor(fnNode) ||
    ts.isSetAccessor(fnNode)
  ) {
    if (fnNode.body) {
      visit(fnNode.body);
    }
  }

  return complexity;
}

function analyzeSourceFile(filePath: string, violations: ComplexityViolation[]): void {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    fileContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  function walk(node: ts.Node): void {
    if (isFunctionLike(node)) {
      const complexity = calculateComplexity(node);
      if (complexity > MAX_COMPLEXITY) {
        const { line } = getLineAndCharacter(sourceFile, node.getStart(sourceFile));
        const name = getNodeName(node, sourceFile);
        violations.push({
          file: filePath,
          line,
          name,
          complexity,
        });
      }
    }
    ts.forEachChild(node, walk);
  }

  walk(sourceFile);
}

function findTsFiles(dir: string, fileList: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTsFiles(fullPath, fileList);
    } else if (entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".d.ts")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function run(): void {
  const srcDir = path.resolve(__dirname, "../src");
  const files = findTsFiles(srcDir);
  const violations: ComplexityViolation[] = [];

  for (const file of files) {
    analyzeSourceFile(file, violations);
  }

  if (violations.length > 0) {
    console.error(`\n❌ Found ${violations.length} function(s) exceeding maximum cyclomatic complexity (${MAX_COMPLEXITY}):\n`);
    for (const v of violations) {
      const relPath = path.relative(process.cwd(), v.file);
      console.error(`  - ${relPath}:${v.line} -> ${v.name} (complexity: ${v.complexity})`);
    }
    console.error("\nPlease refactor with early returns, helper methods, or dedicated handlers.\n");
    process.exit(1);
  }

  console.log(`\n✅ All ${files.length} files in src/ satisfy cyclomatic complexity <= ${MAX_COMPLEXITY}.\n`);
}

run();
