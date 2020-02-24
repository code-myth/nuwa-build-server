import { Response, Request, NextFunction } from "express";
import path from 'path';
import merge from 'lodash/merge';
import childProcess, { SpawnSyncReturns } from "child_process";
import fsExtra from 'fs-extra';
import fs from 'fs';

enum STATUS_CODE {
  SUCCESS,
  FAIL
}

const Git = require('nodegit');
const GIT_BASE_URL = 'git@github.com:code-myth/component-name.git';
const GIT_DOWNLOAD_REPO = 'components-repos';
const PAGE_TEMPLATE_REPO = 'https://github.com/code-myth/page-template.git';
const resolveSpawnSyncReturns = (spawnSyncReturns: childProcess.SpawnSyncReturns<any>, successMessage: string): { code: STATUS_CODE, message: string } => {
  console.log('start [resolveSpawnSyncReturns]');
  if (spawnSyncReturns.error) {
    console.log(`[resolveSpawnSyncReturns > error]:[${spawnSyncReturns.error.message}]`);
    return {
      code: STATUS_CODE.FAIL,
      message: `error:${spawnSyncReturns.error.message}`
    };
  }
  if (spawnSyncReturns.stderr) {
    console.log(`[resolveSpawnSyncReturns > stderr]:[${spawnSyncReturns.stderr}]`);
    return {
      code: STATUS_CODE.FAIL,
      message: `stderr:${spawnSyncReturns.stderr}`
    };
  }
  console.log(`[resolveSpawnSyncReturns]:[${successMessage}]`);
  return {
    code: STATUS_CODE.SUCCESS,
    message: successMessage
  }
};
const install = (dir: string) => {
  console.log('install start');
  try {
    const npmInstallReturns = childProcess.spawnSync('yarn', ['install'], { encoding: 'utf8', cwd: dir });
    return resolveSpawnSyncReturns(npmInstallReturns, 'install success');
  } catch (e) {
    console.log('install fail');
    console.log(e);
    return {
      code: STATUS_CODE.FAIL,
      message: e
    }
  }
};
const build = (dir: string) => {
  console.log('build start');
  try {
    const npmBuildReturns = childProcess.spawnSync('npm', ['run', 'build'], { encoding: 'utf8', cwd: dir });
    return resolveSpawnSyncReturns(npmBuildReturns, 'build success');
  } catch (e) {
    console.log('build fail');
    console.log(e);
    return {
      code: STATUS_CODE.FAIL,
      message: e
    };
  }
};
const clone = async (options: { dir: string, repo: string, branch: string }) => {
  await fsExtra.remove(options.dir);
  try {
    const repo = await Git.Clone(options.repo, options.dir);
    repo.getBranchCommit(options.branch);
    console.log('clone success');
    return {
      code: STATUS_CODE.SUCCESS
    }
  } catch (e) {
    console.log('clone fail');
    console.log(e);
    return {
      code: STATUS_CODE.FAIL,
      message: e
    }
  }
};
const getDirname = (name: string): string => path.resolve(process.cwd(), '..', GIT_DOWNLOAD_REPO, name);
export const buildComponent = async (req: Request, res: Response) => {
  const { body } = req;
  const {
    repo,
    branch = 'master',
    name
  } = body;
  const dir = getDirname(name);
  const cloneReturns = await clone({ repo, dir, branch });
  if (cloneReturns.code === STATUS_CODE.SUCCESS) {
    install(dir);
    const buildReturn = build(dir);
    res.send(buildReturn);
    return;
  }
  res.send({ code: STATUS_CODE.FAIL, message: 'build component fail' });
};
const cloneComponents = async (repos: string[], componentsDir: string) => {
  for (let i = 0; i < repos.length; i++) {
    const componentDir = path.resolve(componentsDir, `Component${i}`);
    await clone({ repo: repos[i], dir: componentDir, branch: 'master' });
  }
};
const mergePackJson = async (componentsLength: number, componentsDir: string) => {
  let packageJson = {};
  for (let i = componentsLength - 1; i >= 0; i--) {
    const packageJsonDir = path.resolve(componentsDir, `Component${i}`, 'package.json');
    const componentPackageJson = await fsExtra.readJSON(packageJsonDir);
    merge(packageJson, componentPackageJson);
  }
  return packageJson;
};
const getAppTSX = (componentDirs: string[]) => {
  let importModule = '';
  let components = '';
  for (let i = 0; i < componentDirs.length; i++) {
    importModule += `import Components${i} from './components/${componentDirs[i]}/src/App.tsx';\n`;
    components += `<Components${i} />\n`;
  }
  return `
import React from 'react';
${importModule}
function App() {
  return (
    <div className="App">
      ${components}
    </div>
  );
}
export default App;
`
};
export const buildPage = async (req: Request, res: Response) => {
  const { body } = req;
  const {
    repos, name
  } = body;
  const dir = getDirname(name);
  const componentsDir = path.resolve(dir, 'src', `components`);
  await clone({ repo: PAGE_TEMPLATE_REPO, dir, branch: 'master' });
  await cloneComponents(repos, componentsDir);
  const packageJson = await mergePackJson(repos.length, componentsDir);
  const packageJsonDir = path.resolve(dir, 'package.json');
  let pagePackageJson = await fsExtra.readJSON(packageJsonDir);
  merge(packageJson, pagePackageJson);
  await fsExtra.writeJson(packageJsonDir, packageJson, { spaces: 2 });
  console.log('merge package.json success');
  const appTSX = getAppTSX(repos.map((repo: string, index: number) => `Component${index}`));
  fs.writeFileSync(path.resolve(dir, 'src', 'App.tsx'), appTSX, { encoding: 'utf-8' });
  console.log('write App.tsx success');
  install(dir);
  build(dir);
  res.send({
    code: STATUS_CODE.SUCCESS,
    message: 'build page success'
  });
};