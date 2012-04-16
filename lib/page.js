
+function(exports){

  /**
   * Middleware array.
   */

  var middleware = [];

  /**
   * Register `path` with callback `fn()`,
   * or route `path`, or `page.start()`.
   *
   * @param {String} path
   * @param {Function} fn...
   * @api public
   */

  function page(path, fn) {
    // route <path> to <callback ...>
    if ('function' == typeof fn) {
      var route = new Route(path);
      for (var i = 1; i < arguments.length; ++i) {
        middleware.push(route.middleware(arguments[i]));
      }
    // show <path> with [state]
    } else if (path) {
      page.show(path, fn);
    // start
    } else {
      page.start();
    }
  }

  /**
   * Start page routing mechanism.
   *
   * @api public
   */

  page.start = function(){
    addEventListener('click', onclick, true);
    addEventListener('popstate', onpopstate, false);
  };

  /**
   * Root path. Override if your app is "mounted"
   * at some other path.
   *
   * @api public
   */

  page.root = '';

  /**
   * Show `path` with optional `ctx` object.
   *
   * @param {String} path
   * @param {Object} ctx
   * @api public
   */

  page.show = function(path, ctx){
    ctx = ctx || {};
    ctx.state = ctx.state || {};
    ctx.state.path = path;
    ctx.save = function(){
      history.replaceState(ctx.state, document.title, path);
    };
    page.dispatch(ctx);
    history.pushState(ctx.state, document.title, path);
  };

  /**
   * Replace `path` with optional `ctx` object.
   *
   * @param {String} path
   * @param {Object} ctx
   * @api public
   */

  page.replace = function(path, ctx){
    ctx = ctx || {};
    ctx.state = ctx.state || {};
    ctx.state.path = path;
    ctx.save = function(){
      history.replaceState(ctx.state, document.title, path);
    };
    page.dispatch(ctx);
    history.replaceState(ctx.state, document.title, path);
  };

  /**
   * Dispatch the given `ctx`.
   *
   * @param {Object} ctx
   * @api private
   */

  page.dispatch = function(ctx){
    var i = 0;

    function next() {
      var fn = middleware[i++];
      if (!fn) return;
      fn(ctx, next);
    }

    next();
  };

  /**
   * Return the pathname void of `page.root`.
   *
   * @return {String}
   * @api public
   */

  page.path = function(){
    var path = location.pathname;
    if (0 == path.indexOf(page.root)) path = path.replace(page.root, '');
    return path;
  };

  /**
   * Initialize `Route` with the given HTTP `path`,
   * and an array of `callbacks` and `options`.
   *
   * Options:
   *
   *   - `sensitive`    enable case-sensitive routes
   *   - `strict`       enable strict matching for trailing slashes
   *
   * @param {String} path
   * @param {Object} options.
   * @api private
   */

  function Route(path, options) {
    options = options || {};
    this.path = path;
    this.method = 'GET';
    this.regexp = pathtoRegexp(path
      , this.keys = []
      , options.sensitive
      , options.strict);
  }

  /**
   * Return route middleware with
   * the given callback `fn()`.
   *
   * @param {Function} fn
   * @return {Function}
   * @api public
   */

  Route.prototype.middleware = function(fn){
    var self = this;
    return function(ctx, next){
      ctx.params = ctx.params || [];
      ctx.path = ctx.state.path;
      if (self.match(ctx.path, ctx.params)) return fn(ctx, next);
      next();
    }
  };

  /**
   * Check if this route matches `path`, if so
   * populate `params`.
   *
   * @param {String} path
   * @param {Array} params
   * @return {Boolean}
   * @api private
   */

  Route.prototype.match = function(path, params){
    var keys = this.keys
      , m = this.regexp.exec(path);

    if (!m) return false;

    for (var i = 1, len = m.length; i < len; ++i) {
      var key = keys[i - 1];

      var val = 'string' == typeof m[i]
        ? decodeURIComponent(m[i])
        : m[i];

      if (key) {
        params[key.name] = undefined !== params[key.name]
          ? params[key.name]
          : val;
      } else {
        // TODO: need to empty previous?...
        params.push(val);
      }
    }

    return true;
  };

  /**
   * Normalize the given path string,
   * returning a regular expression.
   *
   * An empty array should be passed,
   * which will contain the placeholder
   * key names. For example "/user/:id" will
   * then contain ["id"].
   *
   * @param  {String|RegExp|Array} path
   * @param  {Array} keys
   * @param  {Boolean} sensitive
   * @param  {Boolean} strict
   * @return {RegExp}
   * @api private
   */

  function pathtoRegexp(path, keys, sensitive, strict) {
    if (path instanceof RegExp) return path;
    if (path instanceof Array)  path = '(' + path.join('|') + ')';
    path = path
      .concat(strict ? '' : '/?')
      .replace(/\/\(/g, '(?:/')
      .replace(/(\/)?(\.)?:(\w+)(?:(\(.*?\)))?(\?)?/g, function(_, slash, format, key, capture, optional){
        keys.push({ name: key, optional: !! optional });
        slash = slash || '';
        return ''
          + (optional ? '' : slash)
          + '(?:'
          + (optional ? slash : '')
          + (format || '') + (capture || (format && '([^/.]+?)' || '([^/]+?)')) + ')'
          + (optional || '');
      })
      .replace(/([\/.])/g, '\\$1')
      .replace(/\*/g, '(.*)');
    return new RegExp('^' + path + '$', sensitive ? '' : 'i');
  };

  /**
   * Handle "populate" events.
   */

  function onpopstate(e) {
    var ctx = {};
    if (e.state) {
      ctx.state = e.state;
      page.replace(e.state.path, ctx);
    } else {
      ctx.state = {};
      page.show(page.path(), ctx);
    }
  }

  /**
   * Handle "click" events.
   */

  function onclick(e) {
    if ('A' != e.target.nodeName) return;
    e.preventDefault();
    var href = e.target.getAttribute('href');
    page.show(href);
  }

  /**
   * Expose `page`.
   */

  exports.page = page;

}(this);