const path = require('path');
const execa = require('execa');
const expect = require('chai').expect;
const tp = require('../../../test-helpers/test-phases');
const fx = require('../../../test-helpers/fixtures');
const hooks = require('../../../test-helpers/hooks');
const {
  insideTeamCity,
  outsideTeamCity,
} = require('../../../test-helpers/env-variables');
const retryPromise = require('retry-promise').default;
const fetch = require('node-fetch');
const { localIdentName } = require('../src/constants');

const generateCssModulesPattern = ({ name, path: filePath, short }) => {
  const pattern = short ? localIdentName.short : localIdentName.long;
  const genericNames = require('generic-names');
  const generate = genericNames(pattern, { hashPrefix: 'a' });
  return generate(name, filePath);
};

const $inject = 'something.$inject = ["$http"];';

describe('Aggregator: Build', () => {
  let test;

  describe('simple development project with separate styles (sass and less), babel, JSON, commons chunks with custom name, some UMD modules and source maps', () => {
    let resp;
    const compiledSaasStyle = '.a .b {\n  color: red; }';
    const compiledLessStyle = '.a .b {\n  color: red;\n}';
    const bowerrc = {
      registry: {
        search: [
          'https://bower.herokuapp.com',
          'http://wix:wix@mirror.wixpress.com:3333',
        ],
        register: 'http://wix:wix@mirror.wixpress.com:3333',
        publish: 'http://wix:wix@mirror.wixpress.com:3333',
      },
    };

    before(() => {
      test = tp.create();
      resp = test
        .setup(
          {
            '.bowerrc': JSON.stringify(bowerrc, null, 2),
            'petri-specs/specs.infra.Dummy.json': fx.petriSpec(),
            'src/a.js': 'export default "I\'m a module!";',
            'app/b.jsx': 'const b = 2;',
            'src/nativeModules.js': ['fs', 'net', 'tls']
              .map(moduleName => `require(${moduleName})`)
              .join(';'),
            'src/entry.js': 'export default "I\'m a module!";',
            'src/dep.js': `module.exports = function(a){return a + 1;};`,
            'src/app1.js': `const thisIsWorks = true; const aFunction = require('./dep');const a = aFunction(1); require('./app');  require('../app/e/style.scss'); require('../app/b/style.less'); require('./styles/my-file.global.scss'); require('./styles/my-file-less.global.less'); require('./styles/my-file.scss'); require('./styles/my-file.st.css')`,
            'src/app2.js': `const hello = "world"; const aFunction = require('./dep');const a = aFunction(1); require('../app/e/style.less'); require('../app/b/style.less'); require('./moment-locale'); require('awesome-module1/entry.js'); require('lodash/map')`,
            'src/app.json': `{"json-content": 1}`,
            'src/moment-no-locale.js': `import 'moment-no-locale';`,
            'node_modules/moment-no-locale/index.js': `function load() {return require('./locale/' + lang);}`,
            'node_modules/awesome-module1/entry.js':
              'module.exports = function() { return __dirname }',
            'node_modules/awesome-module2/entry.js':
              'module.exports = function() { return __dirname }',
            'node_modules/moment-no-locale/locale/en.js': `module.exports = 'spanish';`,
            'src/moment-locale.js': `require('moment-locale/locale/en')`,
            'node_modules/moment-locale/locale/en.js': `module.exports = 'english';`,
            'src/styles/my-file.global.scss': `.x {.y {color: blue;}}`,
            'src/styles/my-file-less.global.less': `.q {.w {color: blue;}}`,
            'src/styles/my-file.scss': `.a {.b {color: blue;}}`,
            'src/styles/my-file.st.css': `.root {.stylableClass {color: pink;}}`,
            'src/app3.js': `require('./styles/file-with-url.css');`,
            'src/styles/file-with-url.css': `body {
              background: url('../assets/image.jpg');
            }`,
            'src/assets/image.jpg': '(^_^)'.repeat(2500),
            'app/a/style.scss': fx.scss(),
            'app/b/style.less': fx.less(),
            'app/c/style.less': `@import (once) '../b/style.less';`,
            'app/d/style.less': `@import (once) 'some-module/style.less';`,
            'app/e/style.scss':
              '.a {\n.b {\ncolor: black;\n}\n}\n .c {\nuser-select: none;\n}',
            'app/e/style.less': '.a .b {\n  color: black;\n}',
            'node_modules/some-module/style.less': fx.less(),
            'app/assets/some-file': 'a',
            'src/assets/some-file': 'a',
            'dist/old.js': `const hello = "world!";`,
            'src/angular-module.js': fx.angularJs(),
            'angular-module.js': fx.angularJs(),
            'pom.xml': fx.pom(),
            'package.json': fx.packageJson({
              clientProjectName: 'some-client-proj',
              exports: 'MyLibraryEndpoint',
              splitChunks: {
                chunks: 'initial',
                minSize: 0,
                name: 'myChunk',
              },
              entry: {
                first: './app1.js',
                second: './app2.js',
                third: './app3.js',
              },
              features: {
                externalizeRelativeLodash: false,
              },
              externals: ['lodash/map'],
            }),
          },
          [
            hooks.createSymlink(
              'node_modules/awesome-module1/entry.js',
              'node_modules/awesome-module2/entry.js',
            ),
          ],
        )
        .execute('build', ['--source-map']);
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
    });

    after(() => {
      test.teardown();
    });

    it('should build w/o errors', () => {
      expect(resp.code).to.equal(0);
    });

    it('should work when run with node', async () => {
      await execa('node', [
        path.join(test.tmp, './dist/statics/first.bundle.js'),
      ]);
    });

    describe('stylable integration', () => {
      it('should include stylable output as part of the app js bundle', () => {
        expect(test.content('./dist/statics/first.bundle.js')).to.match(
          /stylableClass/g,
        );
      });

      it('should not create a separate css bundle for stylable css', () => {
        expect(test.list('./dist/statics')).to.not.contain.members([
          'first.stylable.bundle.css',
          'second.stylable.bundle.css',
        ]);
      });
    });

    describe('Output for sass, less and babel project', () => {
      it('should log successful build for sass, less, babel and commons chunks projects', () => {
        expect(resp.stdout).to.contain(`Finished 'sass'`);
        expect(resp.stdout).to.contain(`Finished 'less'`);
        expect(resp.stdout).to.contain(`Finished 'babel'`);
      });

      it('should output relative paths in css url statements', () => {
        expect(test.content('./dist/statics/third.css')).to.contain(
          'url(media/image.jpg',
        );
      });
    });

    describe('Sass/Less styles handling with @import statements, globals and RTL', () => {
      it('should use yoshi-sass', () => {
        expect(test.content('dist/app/a/style.scss')).to.contain(
          compiledSaasStyle,
        );
      });

      it('should use yoshi-less', () => {
        expect(test.content('dist/app/b/style.less')).to.contain(
          compiledLessStyle,
        );
      });

      it('should use yoshi-less with @import statements', () => {
        expect(test.content('dist/app/c/style.less')).to.contain(
          compiledLessStyle,
        );
      });

      it('should use yoshi-less with @import statements and consider node_modules', () => {
        expect(test.content('dist/app/d/style.less')).to.contain(
          compiledLessStyle,
        );
      });

      it('should generate RTL Css from bundle', () => {
        expect(test.content('dist/statics/first.rtl.css')).to.contain(
          'color: black;',
        );
        expect(test.content('dist/statics/first.rtl.min.css')).to.contain(
          '{color:#000}',
        );
      });

      it('should generate css attributes prefixes for on separate css file', () => {
        expect(test.content(`dist/statics/first.css`)).to.match(
          /-webkit-user-select: none;/g,
        );
        expect(test.content(`dist/statics/first.css`)).to.match(
          /-ms-user-select:/g,
        );
        expect(test.content(`dist/statics/first.css`)).to.match(
          /user-select: none;/g,
        );
      });

      it('should disable css modules for .global.scss files', () => {
        expect(test.content(`dist/statics/first.css`)).to.contain('.x .y {');
      });

      it('should disable css modules for .global.less files', () => {
        expect(test.content(`dist/statics/first.css`)).to.contain('.q .w {');
      });

      it('should create a separate css file for each entry', () => {
        expect(test.list('./dist/statics')).to.contain.members([
          'first.css',
          'second.css',
        ]);
      });

      it('should generate css modules on separate css file', () => {
        const regex = /\..{6}\s..{6}\s{/;
        expect(test.content(`dist/statics/first.bundle.js`)).not.to.match(
          regex,
        );

        expect(test.content(`dist/statics/first.css`)).to.match(regex);
      });
    });

    describe('ES transpiling with babel', () => {
      it('should use yoshi-babel', () => {
        expect(test.list('dist')).to.include.members(['src', 'app']);
      });

      it('should not create `/es` directory if no `module` field in `package.json` was specified and no commonjs plugin added', () => {
        expect(test.list('dist')).to.not.include('es');
        expect(test.content('dist/src/a.js')).to.contain('exports["default"]');
      });
    });

    describe('Bundling with bundle custom name, sourceMaps, some UMD/AMD modules, commons chunks and stats', () => {
      it('should generate a bundle with custom name', () => {
        expect(test.list('dist/statics')).to.contain('first.bundle.js');
        expect(test.content('dist/statics/first.bundle.js')).to.contain(
          'var thisIsWorks = true;',
        );
      });

      it('should generate a bundle with sourceMaps', () => {
        expect(test.list('dist/statics')).to.contain('first.bundle.js.map');
      });

      it("should consider babel's sourceMaps for bundle", () => {
        expect(test.content('dist/statics/first.bundle.js')).to.contain(
          'var thisIsWorks',
        );
        expect(test.content('dist/statics/first.bundle.js.map')).to.contain(
          'const thisIsWorks',
        );
      });

      it('should generate an additional myChunk.bundle.js when `splitChunks` option in package.json is a configuration object, myChunk chunk should have the common parts and the other chunks should not', () => {
        expect(test.list('dist/statics')).to.contain('first.bundle.js');
        expect(test.list('dist/statics')).to.contain('second.bundle.js');
        expect(test.list('dist/statics')).to.contain('myChunk.chunk.js');
        expect(test.list('dist/statics')).to.contain('myChunk.chunk.min.js');
        expect(test.list('dist/statics')).to.contain('myChunk.chunk.js.map');
        expect(test.content('dist/statics/myChunk.chunk.js')).to.contain(
          'module.exports = function (a) {\n  return a + 1;\n};',
        );
        expect(test.content('dist/statics/first.bundle.js')).to.not.contain(
          'module.exports = function (a) {\n  return a + 1;\n};',
        );
        expect(test.content('dist/statics/second.bundle.js')).to.not.contain(
          'module.exports = function (a) {\n  return a + 1;\n};',
        );
      });

      it('should add myChunk.css if there is any common css/scss/less required, the common css should be in the myChunk.css chunk while not in the other chunks', () => {
        expect(test.list('dist/statics')).to.contain('first.css');
        expect(test.list('dist/statics')).to.contain('second.css');
        expect(test.list('dist/statics')).to.contain('myChunk.chunk.css');
        expect(test.list('dist/statics')).to.contain('myChunk.chunk.min.css');
        expect(test.list('dist/statics')).to.contain('myChunk.chunk.css.map');
        expect(test.content('dist/statics/myChunk.chunk.css')).to.contain(
          '{\n  color: red;\n}',
        );
        expect(test.content('dist/statics/first.css')).to.not.contain(
          '{\n  color: red;\n}',
        );
        expect(test.content('dist/statics/second.css')).to.not.contain(
          '{\n  color: red;\n}',
        );
      });

      it('should ignore locale modules from within moment', () => {
        expect(test.content('dist/statics/myChunk.chunk.js')).not.to.contain(
          'spanish',
        );
      });

      it('should bundle locale modules from outside of moment', () => {
        expect(test.content('dist/statics/myChunk.chunk.js')).to.contain(
          'english',
        );
      });

      it('should generate a bundle with umd library support', () => {
        expect(test.content('dist/statics/first.bundle.js')).to.contain(
          'exports["MyLibraryEndpoint"]',
        );
        expect(test.content('dist/statics/first.bundle.js')).to.contain(
          'root["MyLibraryEndpoint"]',
        );
      });

      it('should generate a bundle with named amd library support', () => {
        expect(test.content('dist/statics/first.bundle.js')).to.contain(
          'define("MyLibraryEndpoint", [], factory)',
        );
      });
    });

    it('should load JSON file correctly', () => {
      expect(test.content('dist/statics/first.bundle.js')).to.contain(
        `"json-content":1`,
      );
    });

    describe('Copying assets and other files', () => {
      it('should use yoshi-copy', () => {
        expect(test.list(`dist/src/assets`)).to.include('some-file');
      });
    });

    describe('yoshi-maven-statics', () => {
      it('should use yoshi-maven-statics', () => {
        expect(
          test.content('maven/assembly/tar.gz.xml').replace(/\s/g, ''),
        ).to.contain(
          `
          <assembly xmlns="http://maven.apache.org/plugins/maven-assembly-plugin/assembly/1.1.0"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:schemaLocation="http://maven.apache.org/plugins/maven-assembly-plugin/assembly/1.1.0 http://maven.apache.org/xsd/assembly-1.1.0.xsd">
              <id>wix-angular</id>
              <baseDirectory>/</baseDirectory>
              <formats>
                  <format>tar.gz</format>
              </formats>
              <fileSets>
                  <fileSet>
                      <directory>\${project.basedir}/node_modules/some-client-proj/dist</directory>
                      <outputDirectory>/</outputDirectory>
                      <includes>
                          <include>*</include>
                          <include>*/**</include>
                      </includes>
                  </fileSet>
              </fileSets>
          </assembly>
        `.replace(/\s/g, ''),
        );
      });
    });

    describe('Cleaning dist after each build', () => {
      it('should use yoshi-clean', () => {
        expect(resp.stdout).to.include(`Finished 'clean'`);
        expect(test.list('dist')).to.not.include('old.js');
        expect(test.list('dist/src')).to.include('app1.js');
      });
    });

    describe('Using yoshi-petri', () => {
      it('should use yoshi-petri', () => {
        expect(test.list('dist', '-R')).to.contain(
          'statics/petri-experiments.json',
        );
      });
    });

    describe('Considering symlinks', () => {
      it('should not resolve symlinks to their symlinked location', () => {
        const module1 = '.call(this, "../node_modules/awesome-module1")';
        const module2 = '.call(this, "../node_modules/awesome-module2")';

        expect(test.content(`dist/statics/myChunk.chunk.js`)).to.contain(
          module1,
        );
        expect(test.content(`dist/statics/myChunk.chunk.js`)).to.not.contain(
          module2,
        );
      });
    });

    describe('Externalize relative lodash (lodash/map -> lodash.map)', function() {
      it('should be disabled when features.externalizeRelativeLodash = false', () => {
        expect(test.content('dist/statics/second.bundle.js')).not.to.contain(
          ').map',
        );
      });
    });

    describe('Using angular ngInject annotations for babel project', function() {
      it('are not executed when project is not Angular and EcmaScript', () => {
        expect(test.content('dist/src/angular-module.js')).not.to.contain(
          $inject,
        );
        expect(test.content('src/angular-module.js')).not.to.contain($inject);
        expect(test.content('angular-module.js')).not.to.contain($inject);
      });
    });
  });

  describe('simple tree shaking scenario', () => {
    let resp;

    before(() => {
      test = tp.create();
      resp = test
        .setup({
          'src/a.js': `import {xxx} from './b'; console.log(xxx);`,
          'src/b.js': `export const xxx = 111111; export const yyy = 222222;`,
          'package.json': fx.packageJson({
            entry: './a.js',
          }),
        })
        .execute('build');
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
    });

    after(() => {
      test.teardown();
    });

    it('should build w/o errors', () => {
      expect(resp.code).to.equal(0);
    });

    it('should transpile imports to commonjs', () => {
      expect(test.content('dist/src/a.js')).to.contain('require("./b")');
    });

    it('should tree shake unused variable', () => {
      const bundle = test.content('dist/statics/app.bundle.min.js');
      expect(bundle).to.contain('111111');
      expect(bundle).not.to.contain('222222');
    });
  });

  describe('simple tree shaking scenario in typescript', () => {
    let resp;

    before(() => {
      test = tp.create();
      resp = test
        .setup({
          'tsconfig.json': fx.tsconfig({
            compilerOptions: {
              lib: ['esnext'],
            },
          }),
          'src/a.ts': `import {xxx} from './b'; import('./c').then(() => console.log(xxx));`,
          'src/b.ts': `export const xxx = 111111; export const yyy = 222222;`,
          'src/c.ts': `export default 'hello';`,
          'package.json': fx.packageJson({
            entry: './a.ts',
          }),
        })
        .execute('build');
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
    });

    after(() => {
      test.teardown();
    });

    it('should build w/o errors', () => {
      expect(resp.code).to.equal(0);
    });

    it('should transpile imports to commonjs', () => {
      expect(test.content('dist/src/a.js')).to.contain('require("./b")');
    });

    it('should support code splitting with dynamic import statements', () => {
      expect(test.content('dist/statics/1.chunk.js')).to.contain(`'hello'`);
    });

    it('should tree shake unused variable', () => {
      const bundle = test.content('dist/statics/app.bundle.min.js');
      expect(bundle).to.contain('111111');
      expect(bundle).not.to.contain('222222');
    });
  });

  describe('simple development project with 1 entry point, ES modules, non-separate styles, babel, commons chunks and w/o cssModules', () => {
    let resp;
    before(() => {
      test = tp.create();

      resp = test
        .setup({
          'src/a.js': `export default "I'm a module!"; import './a.scss'; import './a.st.css'; require('lodash/map')`,
          'src/a.scss': `.x {.y {user-select: none;}}`,
          'src/a.st.css': `.root {.stylableClass {color: pink;}}`,
          'src/assets/file': '1',
          'src/something.js': fx.angularJs(),
          'something/something.js': fx.angularJs(),
          'something.js': fx.angularJs(),
          'package.json': fx.packageJson(
            {
              entry: './a.js',
              separateCss: false,
              cssModules: false,
              features: {
                externalizeRelativeLodash: true,
              },
              externals: ['lodash'],
            },
            {},
            {
              module: 'dist/es/src/a.js',
            },
          ),
        })
        .execute('build');
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
    });

    after(() => {
      test.teardown();
    });

    it('should build w/o errors project using modules, non-separate sass, less, babel and commons chunks', () => {
      expect(resp.code).to.equal(0);
    });

    it('should not transpile modules for `/es` content if `module` field in `package.json` was specified', () => {
      expect(test.list('dist')).to.include.members(['src', 'statics', 'es']);
      expect(test.content('dist/es/src/a.js')).to.contain('export default');
      expect(test.list('dist/es/src/assets')).to.contain('file');
      expect(test.content('dist/src/a.js')).to.contain('exports["default"] =');
      expect(test.list('dist/src')).to.contain('a.scss');
    });

    it('should support single entry point in package.json', () => {
      expect(test.content('dist/statics/app.bundle.js')).to.contain(
        '"I\'m a module!"',
      );
    });

    it('should generate a bundle with css', () => {
      expect(test.content('dist/statics/app.bundle.js')).to.contain('.x .y');
    });

    it('should be enabled when features.externalizeRelativeLodash = true', () => {
      expect(test.content('dist/statics/app.bundle.js')).to.contain(').map');
    });

    it('should generate css attributes prefixes', () => {
      expect(test.content(`dist/statics/app.bundle.js`)).to.match(
        /-webkit-user-select: none;/g,
      );
      expect(test.content(`dist/statics/app.bundle.js`)).to.match(
        /-ms-user-select:/g,
      );
      expect(test.content(`dist/statics/app.bundle.js`)).to.match(
        /user-select: none;/g,
      );
    });

    describe('stylable integration', () => {
      it('should include stylable output as part of the app js bundle', () => {
        expect(test.content('dist/statics/app.bundle.js')).to.match(
          /stylableClass/g,
        );
      });

      it('should not create a separate css bundle for stylable css', () => {
        expect(test.list('./dist/statics')).to.not.contain(
          'app.stylable.bundle.css',
        );
      });
    });
  });

  describe('simple project with typescript and angular that runs on CI (Teamcity) and w/ 1 entry point w/o extension', () => {
    let resp;

    before(() => {
      test = tp.create();

      resp = test
        .setup({
          'src/client.ts': `console.log("hello");
            import './styles/style.scss';
            import './other';`,
          'src/app.js': `const a = 1;`,
          'src/other.tsx': 'const b = 2',
          'src/something.ts': fx.angularJs(),
          'something/something.js': fx.angularJs(),
          'something.js': fx.angularJs(),
          'src/styles/style.scss': `.a {.b {color: red;}} .c{margin: 10px 20px 10px 20px;}`,
          'tsconfig.json': fx.tsconfig(),
          'package.json': fx.packageJson(
            {
              entry: './client',
              separateCss: 'prod',
              cssModules: true,
            },
            {
              angular: '1.5.0',
            },
          ),
        })
        .execute('build', [], insideTeamCity);
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
    });

    after(() => {
      test.teardown();
    });

    it('should build w/o errors', () => {
      expect(resp.code).to.equal(0);
    });

    it('should not transpile with babel if there is tsconfig', () => {
      expect(test.list('dist/src')).to.not.contain('app.js');
      expect(test.content('dist/src/other.js')).to.contain('var b = 2');
    });

    it('should generate bundle if entry is a typescript file and entry extension is omitted', () => {
      expect(test.list('dist/statics')).to.contain('app.bundle.js');
    });

    it('should generate a minified bundle on ci', () => {
      expect(test.list('dist/statics')).to.contain('app.bundle.min.js');
      expect(test.list('dist/statics')).to.contain('app.bundle.min.js.map');
    });

    it('should separate css with prod setting on teamcity', () => {
      expect(test.content('dist/statics/app.bundle.js')).not.to.contain(
        'color: red',
      );
      expect(test.content('dist/statics/app.css')).to.contain('color: red');
    });

    it('should generate css modules on minified css bundle with hash only', () => {
      const hashA = generateCssModulesPattern({
        name: 'a',
        path: 'styles/style.scss',
        short: true,
      });

      const hashB = generateCssModulesPattern({
        name: 'b',
        path: 'styles/style.scss',
        short: true,
      });

      const expectedCssPattern = `.${hashA} .${hashB}{`;
      expect(test.content(`dist/statics/app.min.css`)).to.contain(
        expectedCssPattern,
      );
    });

    it('should generate css modules on regular bundle with long name and hash', function() {
      const hashA = generateCssModulesPattern({
        name: 'a',
        path: 'styles/style.scss',
        short: true,
      });
      const hashB = generateCssModulesPattern({
        name: 'b',
        path: 'styles/style.scss',
        short: true,
      });

      const expectedCssPattern = `.${hashA} .${hashB} {`;
      expect(test.content(`dist/statics/app.css`)).to.contain(
        expectedCssPattern,
      );
    });

    it('should generate separated minified Css from bundle on ci', () => {
      expect(test.content('dist/statics/app.bundle.js')).not.to.contain(
        '{\n  color: red; }',
      );
      expect(test.content('dist/statics/app.min.css')).to.contain(
        '{color:red}',
      );
    });

    it('should generate css bundle minified with cssnano on ci', () => {
      expect(test.content('dist/statics/app.min.css')).not.to.contain(
        '{margin:10px 20px 10px 20px}',
      );
      expect(test.content('dist/statics/app.min.css')).to.contain(
        '{margin:10px 20px}',
      );
    });

    it('are executed when project is Angular and TypeScript', () => {
      expect(test.content('dist/src/something.js')).to.contain($inject);
      expect(test.content('something.js')).not.to.contain($inject);
    });

    it('should generate source maps', () => {
      expect(test.list('dist/statics')).to.contain('app.bundle.min.js.map');
      expect(test.list('dist/statics')).to.contain('app.bundle.js.map');
    });
  });

  describe('simple project with typescript and angular that runs on CI (Teamcity) and with 1 entry point w/o extension', () => {
    let resp;

    before(() => {
      test = tp.create();

      resp = test
        .setup({
          'src/client.ts': `console.log("hello"); import './styles/style.scss';`,
          'src/a.ts': 'export default "I\'m a module!";',
          'src/styles/style.scss': `.a {.b {color: red;}}`,
          'src/something.ts': fx.angularJs(),
          'something/something.js': fx.angularJs(),
          'something.js': fx.angularJs(),
          'tsconfig.json': fx.tsconfig({ compilerOptions: { module: 'es6' } }),
          'package.json': fx.packageJson({
            separateCss: 'prod',
            cssModules: true,
          }),
        })
        .execute('build', [], { NODE_ENV: 'PRODUCTION' });
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
    });

    after(() => {
      test.teardown();
    });

    it('should build w/o errors', () => {
      expect(resp.code).to.equal(0);
    });

    it('should allow generating a bundle by default with both .js and .ts extensions', () => {
      expect(test.list('dist/statics')).to.contain('app.bundle.js');
    });

    it('should separate Css with prod setting on production', () => {
      expect(test.content('dist/statics/app.bundle.js')).not.to.contain(
        'color: red',
      );
      expect(test.content('dist/statics/app.css')).to.contain('color: red');
    });

    it('are not executed when project is not Angular and TypeScript', () => {
      expect(test.content('dist/src/something.js')).not.to.contain($inject);
      expect(test.content('something.js')).not.to.contain($inject);
    });

    it('should not create `/es` directory if no `module` field in `package.json` was specified and no commonjs plugin added', () => {
      expect(test.list('dist')).to.not.include('es');
      expect(test.content('dist/src/a.js')).to.contain('export default');
    });
  });

  describe.skip('simple development project with 1 entry point, ES modules, cssModules, typescript', () => {
    let resp;
    before(() => {
      test = tp.create();

      resp = test
        .setup({
          'src/client.ts': `console.log("hello"); import './styles/style.scss'; import './styles/stylableFile.st.css'`,
          'src/a.ts': 'export default "I\'m a module!";',
          'src/styles/style.scss': `.a {.b {color: red;}}`,
          'src/styles/stylableFile.st.css': `.root {.stylableClass {color: pink;}}`,
          'src/something.ts': fx.angularJs(),
          'something/something.js': fx.angularJs(),
          'something.js': fx.angularJs(),
          'tsconfig.json': fx.tsconfig({ compilerOptions: { module: 'es6' } }),
          'package.json': fx.packageJson(
            {
              separateCss: 'prod',
              cssModules: true,
            },
            {},
            {
              module: 'dist/es/src/a.js',
            },
          ),
        })
        .execute('build', [], { NODE_ENV: 'PRODUCTION' });
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
    });

    after(() => {
      test.teardown();
    });

    it('should build w/o errors', () => {
      expect(resp.code).to.equal(0);
    });

    it('should not transpile modules for `/es` content if `module` field in `package.json` was specified', () => {
      expect(test.list('dist')).to.include.members(['src', 'statics', 'es']);
      expect(test.content('dist/es/src/a.js')).to.contain('export default');
      expect(test.content('dist/src/a.js')).to.contain('exports.default =');
      expect(test.list('dist/es/src/styles')).to.contain('style.scss');
      expect(test.list('dist/src/styles')).to.contain('style.scss');
    });

    describe('stylable integration', () => {
      it('should hash with {shortNamespaces:false} in the generated stylable output', () => {
        expect(test.content('dist/statics/app.bundle.min.js')).to.match(
          /stylableFile\d+/g,
        );
      });
    });
  });

  describe('build project with --stats flag', () => {
    before(() => {
      test = tp.create();
      test
        .setup({
          'src/client.js': '',
          'package.json': fx.packageJson(),
        })
        .execute('build', ['--stats']);
    });

    it('should generate stats files', () => {
      expect(test.list('target')).to.contain('webpack-stats.json');
    });
  });

  describe('build project with --analyze flag', () => {
    const analyzerServerPort = '8888';
    const analyzerContentPart =
      'window.chartData = [{"label":"app.bundle.min.js"';

    before(() => {
      test = tp.create();
      test
        .setup({
          'src/client.js': '',
          'package.json': fx.packageJson(),
        })
        .spawn('build', ['--analyze']);
    });

    it('should serve webpack-bundle-analyzer server', () => {
      return checkServerIsServing({ port: analyzerServerPort }).then(content =>
        expect(content).to.contain(analyzerContentPart),
      );
    });
  });

  describe('build on local machine', () => {
    it('should not generate source maps if not requested', () => {
      test = tp.create();
      test
        .setup({
          'src/client.js': 'const aVariable = 3',
          'package.json': fx.packageJson(),
        })
        .execute('build', [], outsideTeamCity);

      expect(test.list('dist/statics')).not.to.contain('app.bundle.min.js.map');
      expect(test.list('dist/statics')).not.to.contain('app.bundle.js.map');
    });
  });

  describe('build project with --source-map flag', () => {
    it('should generate source maps', () => {
      test = tp.create();
      test
        .setup({
          'src/client.js': 'const aVariable = 3',
          'package.json': fx.packageJson(),
        })
        .execute('build', ['--source-map'], outsideTeamCity);

      expect(test.list('dist/statics')).to.contain('app.bundle.min.js.map');
      expect(test.list('dist/statics')).to.contain('app.bundle.js.map');
    });
  });

  describe('build projects with individual cases', () => {
    beforeEach(() => {
      test = tp.create();
    });

    afterEach(function() {
      if (this.currentTest.state === 'failed') {
        test.logOutput();
      }
      test.teardown();
    });

    describe('build project with angular dependency and w/o entry files and default entries', () => {
      it('should exit with code 0 and not create bundle.js when there is no custom entry configures and default entry does not exist', () => {
        const res = test
          .setup({
            'tsconfig.json': fx.tsconfig({ files: ['src/example.ts'] }),
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
            'src/example.ts': `console.log('hooray')`,
          })
          .execute('build');

        expect(res.code).to.equal(0);
        expect(test.list('dist/statics')).not.to.contain('app.bundle.js');
      });
    });

    describe('build project error cases', () => {
      describe('Babel', () => {
        it('should fail with exit code 1', () => {
          const resp = test
            .setup({
              'src/a.js': 'function ()',
              'package.json': fx.packageJson(),
              'pom.xml': fx.pom(),
            })
            .execute('build');
          expect(resp.code).to.equal(1);
          expect(resp.stderr).to.contain('Unexpected token (1:9)');
          expect(resp.stderr).to.contain('1 | function ()');
        });
      });

      describe('Typescript', () => {
        it('should fail with exit code 1', () => {
          const resp = test
            .setup({
              'src/a.ts': 'function ()',
              'tsconfig.json': fx.tsconfig(),
              'package.json': fx.packageJson(),
              'pom.xml': fx.pom(),
            })
            .execute('build');

          expect(resp.code).to.equal(1);
          expect(resp.stderr).to.contain('error TS1003: Identifier expected');
        });

        it('should exit with code 1 when tsconfig is malformed', () => {
          const resp = test
            .setup({
              'src/a.ts': 'console.log("hello");',
              'tsconfig.json': '(^_^)',
              'package.json': fx.packageJson(),
              'pom.xml': fx.pom(),
            })
            .execute('build');

          expect(resp.code).to.equal(1);
        });
      });

      it('should exit with code 1 with a custom entry that does not exist', () => {
        const res = test
          .setup({
            'tsconfig.json': fx.tsconfig(),
            'package.json': fx.packageJson({
              entry: './hello',
            }),
            'pom.xml': fx.pom(),
          })
          .execute('build');

        expect(res.code).to.equal(1);
        expect(test.list('dist/statics')).not.to.contain('app.bundle.js');
      });

      it("should fail with exit code 1 when yoshi can't transpile sass file", () => {
        const res = test
          .setup({
            'src/client.js': "require('./style1.scss');",
            'src/style.scss': `.a {.b {color: red;}}`,
            'package.json': fx.packageJson(),
          })
          .execute('build');

        expect(res.code).to.equal(1);
      });

      it('should fail when a module has missing exports', () => {
        const resp = test
          .setup({
            'src/client.js': `import { hello } from './hello'; console.log(hello);`,
            'src/hello.js': `const hello = 'world'; export default 'world';`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .execute('build');

        expect(resp.code).to.equal(1);
        expect(resp.stderr).to.contain(
          "export 'hello' was not found in './hello'",
        );
      });

      it("should fail with exit code 1 when yoshi can't transpile less file", () => {
        const resp = test
          .setup({
            'src/client.js': '',
            'app/a/style.less': '.a {\n.b\ncolor: red;\n}\n}\n',
            'package.json': fx.packageJson(),
          })
          .execute('build');

        expect(resp.code).to.equal(1);
        expect(resp.stdout).to.contain(`Failed 'less'`);
        expect(resp.stderr).to.contain(`Unrecognised input`);
      });

      it("should fail with exit code 1 when yoshi can't transpile js file", () => {
        const res = test
          .setup({
            'src/client.js': `const aFunction = require('./dep');const a = aFunction(1);`,
            'src/dep.js': `module.exports = a => {`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .execute('build');
        expect(res.code).to.equal(1);
        expect(res.stderr).to.contain('Unexpected token (2:0)');
      });
    });

    describe('build project with resolve alias', () => {
      it('should exit with exit code 0', () => {
        const res = test
          .setup({
            'node_modules/foo/index.js': '',
            'src/client.js': "require('bar');",
            'package.json': fx.packageJson({
              resolveAlias: {
                bar: 'foo',
              },
            }),
          })
          .execute('build');

        expect(res.code).to.equal(0);
      });
    });

    describe('jsonpFunction', () => {
      it('should use custom jsonpFunction name according to the project name', () => {
        const res = test
          .setup({
            'src/client.js': "import('./foo')",
            'src/foo.js': "console.log('bar')",
            'package.json': JSON.stringify({
              name: 'my-project',
            }),
          })
          .execute('build');

        expect(res.code).to.equal(0);
        expect(test.content('dist/statics/app.bundle.min.js')).to.contain(
          'webpackJsonp_my_project',
        );
      });
    });

    describe('build project with 2 entry points which are bundled in UMD modules', () => {
      it('should be anonymous AMD modules if config has {umdNamedDefine: false}', () => {
        test
          .setup({
            'package.json': fx.packageJson({
              umdNamedDefine: false,
              exports: '[name]',
              entry: {
                a: './entryA.js',
                b: './entryB.js',
              },
              externals: ['dep-for-a-module', 'dep-for-b-module'],
            }),
            'src/entryA.js': `const dependency = require('dep-for-a-module'); module.exports = 'A'`,
            'src/entryB.js': `const dependency = require('dep-for-b-module'); module.exports = 'B'`,
          })
          .execute('build', []);

        expect(test.content('dist/statics/a.bundle.js')).contain(
          `define(["dep-for-a-module"], `,
        );
        expect(test.content('dist/statics/b.bundle.js')).contain(
          `define(["dep-for-b-module"], `,
        );
      });
    });
  });

  describe.skip('yoshi-check-deps', () => {
    it("should run yoshi-check-deps and do nothing because yoshi isn't installed", () => {
      const resp = test
        .setup({ 'package.json': fx.packageJson() })
        .execute('build');
      expect(resp.stdout).to.contain('checkDeps');
    });
  });

  function checkServerIsServing({
    backoff = 100,
    max = 100,
    port = fx.defaultServerPort(),
    file = '',
  } = {}) {
    return retryPromise({ backoff, max }, () =>
      fetch(`http://localhost:${port}/${file}`).then(res => res.text()),
    );
  }
});
