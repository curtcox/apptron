// Section names select the embedded file’s Ace highlighter.
export function installTxtarMode(ace) {
  ace.define('ace/mode/txtar_highlight_rules', ['require','exports','module','ace/lib/oop','ace/mode/text_highlight_rules'], function(require, exports) {
    const oop = require('ace/lib/oop'), TextHighlightRules = require('ace/mode/text_highlight_rules').TextHighlightRules;
    const extensions = { sh: 'sh', envrc: 'sh', envbuild: 'sh', py: 'python', js: 'javascript', mjs: 'javascript', c: 'c_cpp', h: 'c_cpp', go: 'golang', Makefile: 'makefile' };
    const Rules = function() {
      const section = { regex: '^-- (.+) --$', token: 'entity.name.section', next: 'text-start', onMatch: function(value) {
        const name = /^-- (.+) --$/.exec(value)?.[1] || '';
        if (name.endsWith(' (base64)')) { this.next = 'binary'; return 'entity.name.section'; }
        const language = extensions[name.split('/').pop().split('.').pop()] || 'text';
        this.next = language + '-start'; return 'entity.name.section';
      } };
      this.$rules = { start: [section, { token: 'comment', regex: '^#.*$' }, { token: 'keyword', regex: '^[\\w-]+:' }], binary: [section, { defaultToken: 'string' }] };
      for (const language of new Set(['text', ...Object.values(extensions)])) {
        const FileRules = ace.require(`ace/mode/${language}_highlight_rules`)?.[language === 'c_cpp' ? 'c_cppHighlightRules' : language === 'golang' ? 'GolangHighlightRules' : language === 'makefile' ? 'MakefileHighlightRules' : language === 'javascript' ? 'JavaScriptHighlightRules' : language.charAt(0).toUpperCase() + language.slice(1) + 'HighlightRules'];
        if (FileRules) { this.embedRules(FileRules, language + '-', []); for (const [key, rules] of Object.entries(this.$rules)) if (key.startsWith(language + '-')) rules.unshift({ ...section }); }
        else this.$rules[language + '-start'] = [section, { defaultToken: 'text' }];
      }
      this.normalizeRules();
    };
    oop.inherits(Rules, TextHighlightRules); exports.TxtarHighlightRules = Rules;
  });
  ace.define('ace/mode/txtar', ['require','exports','module','ace/lib/oop','ace/mode/text','ace/mode/txtar_highlight_rules'], function(require, exports) {
    const Mode = function() { this.HighlightRules = require('ace/mode/txtar_highlight_rules').TxtarHighlightRules; };
    require('ace/lib/oop').inherits(Mode, require('ace/mode/text').Mode); Mode.prototype.$id = 'ace/mode/txtar'; exports.Mode = Mode;
  });
}
