/**
 * RequireJS 配置。
 * 在 require.js 之前以 `var require = {...}` 的形式声明，RequireJS 会自动读取。
 */
var require = {
  baseUrl: '/js',
  waitSeconds: 30,
  // 上线后可用 urlArgs: 'v=1.0.0' 强制刷新缓存

  paths: {
    // 第三方库统一走 /vendor（映射到 node_modules），生产环境换成 CDN / 构建产物
    jquery: '/vendor/jquery/dist/jquery.min',
    vue: '/vendor/vue/dist/vue.min',

    // 注意：element-ui 的 UMD 包是以 define('ELEMENT', ['vue'], factory) 注册的，
    // 模块名必须与之一致，写成 'element-ui' 会因找不到 define 而加载超时。
    ELEMENT: '/vendor/element-ui/lib/index',

    // 业务模块
    modules: 'modules'
  },

  // vue 是匿名 define（RequireJS 按路径自动归属），jquery / ELEMENT 是具名 define，
  // 三者都无需 shim
  shim: {}
};
