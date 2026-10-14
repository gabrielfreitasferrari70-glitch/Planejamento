const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
module.exports=function(file){const filename=path.resolve(__dirname,'..',file),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(fs.readFileSync(filename,'utf8'),filename);return loaded.exports};
