var net = require('net');
var crypto = require('crypto');
var nodefs = require("fs");
var ejs = require("ejs");
var path = require('path');

const os = require('os');
const config = require('config');
const encrypt_conf = config.get('system.encryption');
const secret_key = config.get('system.secret_key');
const serverinfo = config.get('system.server');
const server_addr = serverinfo.ip;
const server_port = serverinfo.port;

const firwall = config.get('system.firewall');
const fw_state = firwall.state;
const fw_ipv4_list = firwall.ipv4;
const fw_ipv6_list = firwall.ipv6;

const repolist = config.get('system.repo');
const PLATFORM = os.platform();
const ROOT_PATH = path.join(__dirname);
const CMD_PATH = path.join(ROOT_PATH,'cmd',path.sep);
const TEMPLATE_PATH = path.join(ROOT_PATH,'template',path.sep) ;

const IV = encrypt_conf.iv;
const KEY = encrypt_conf.key;
const CIPHER = encrypt_conf.cipher;

const clearEncoding = 'utf8';
const cipherEncoding = 'base64';/*加密*/

//运行linux bash 脚本
function runbashcmd(bashfile, arg) {
  console.log('run linux shell');
  const defaults = {
    cwd: CMD_PATH
  };
  const { execFile } = require('child_process');
  const child = execFile(bashfile, arg, defaults, (error, stdout, stderr) => {
    if (error) {
      throw error;
    }
    console.log(stdout);
  });
}

// 运行windows bat命令
function runbatcmd(batfile, arg) {
  console.log('run windows cmd');
  const defaults = {
    cwd: CMD_PATH
  };
  const { spawn } = require('child_process');
  var cmdline = ['/c', batfile].concat(arg);
  console.log('arg'+cmdline);
  const bat = spawn('cmd.exe', cmdline, defaults);

  bat.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  bat.stderr.on('data', (data) => {
    console.log(data.toString());
  });

  bat.on('exit', (code) => {
    console.log(`Child exited with code ${code}`);
  });
}
//运行命令
function runcmd(extname, cmdfile, arg) {
    //检查template目录
    nodefs.exists(cmdfile, function (cmdfile_exists) {
      if (!cmdfile_exists) {
        console.log( cmdfile + "No such file or directory");
        return false;
      }
    });
  switch (PLATFORM) {
    case 'win32':
      switch (extname) {
        case '.bat':
          runbatcmd(cmdfile, arg);
          break
      }
      break;
    case 'linux':
      switch (extname) {
        case '.sh':
          runbashcmd(cmdfile, arg);
          break
      }
      break;
  }


}
// 渲染脚本文件
function render_cmd(filename, newext, github) {
  str = nodefs.readFileSync(TEMPLATE_PATH + filename, "utf8")  //先读文件
  var cmdfile = ejs.render(str, {
    github
  })
  console.log(cmdfile);
  var newfile = path.basename(TEMPLATE_PATH + filename, '.ejsh')
  var newcmdfile = CMD_PATH + newfile + newext;
  var newfd = nodefs.openSync(newcmdfile, 'w', 0755);
  nodefs.writeSync(newfd, cmdfile);
  nodefs.closeSync(newfd);
  return newcmdfile;
}

// 生成脚本
function generate_cmd(ejsfile, extname, args, jsonstr) {
  //检查template目录
  nodefs.exists(TEMPLATE_PATH, function (t_exists) {
    if (!t_exists) {
      console.log(TEMPLATE_PATH + "No such file or directory,Create and set read permissions.");
      return false;
    }
  });
  // 检查cmd目录
  nodefs.exists(CMD_PATH, function (c_exists) {
    if (!c_exists) {
      console.log(CMD_PATH + "No such file or directory,Create and set read and write permissions.");
      return false;
    }
  });

  nodefs.exists(TEMPLATE_PATH + ejsfile, function (exists) {
    if (exists) {
      //渲染命令
      newcmdfile = render_cmd(ejsfile, extname, jsonstr);
      runcmd(extname, newcmdfile, args);
    } else {
      console.log(TEMPLATE_PATH + "No such file or directory," + ejsfile);
      return false;
    }
  });
}

// 判断是否是允许的ip
function isAllow(remoteAddress) {
  //开启时,只允许列表内的ip通过
  if (fw_state) {
    if (fw_ipv4_list.indexOf(remoteAddress)!=-1
      || fw_ipv6_list.indexOf(remoteAddress)!=-1) {
      return true;
    }
  }else{
    return true;
  }
  return false;
}
// 根据版本库名称,选择不同的处理流程.
function SelectRepo(data) {
  var github = JSON.parse(data);
  console.log(github);
  var git_repo_name = github.repository.full_name;
  for (index in repolist) {
    if (git_repo_name == repolist[index].name) {
      console.log(repolist[index].name, repolist[index].cmd);
      var argArr =  repolist[index].arg==""?[]:repolist[index].arg.split(" ");
      if (repolist[index].generate){
        // 如果使用模版生成生成命令.
        generate_cmd(repolist[index].cmd, repolist[index].ext, argArr, github)
      }else{
        // 不使用模版直接调用命令
        runcmd(repolist[index].ext, repolist[index].cmd, argArr);
      }
    }
  }
}

// 类型转换
function Uint8ArrayToString(fileData) {
  var dataString = "";
  for (var i = 0; i < fileData.length; i++) {
    dataString += String.fromCharCode(fileData[i]);
  }
  return dataString
}

// 加密函数
function Encrypt(str) {
  var cipher = crypto.createCipheriv(CIPHER, KEY, IV);
  var chpherstr = cipher.update(str, clearEncoding, cipherEncoding);
  chpherstr += cipher.final(cipherEncoding);
  return chpherstr;
}

// 解密函数
function Decrypt(str) {
  var decipher = crypto.createDecipheriv(CIPHER, KEY, IV);
  var decipherstr = decipher.update(str, cipherEncoding, clearEncoding);
  try {
    decipherstr += decipher.final(clearEncoding);
  } catch (e) {
    console.log('Decryption failure!');
    return false;
  }
  return decipherstr;
}

// var data = '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';

// var datastr = Decrypt(data);
// SelectRepo(datastr);
// return 0;

var chatServer = net.createServer(
  function (socket) {
    socket.on('data', function (data) {
      data_str = Uint8ArrayToString(data);
      RequestVal = Decrypt(data_str);//解密字符串
      if (RequestVal) {
        console.log('Server：The data received by the client is ==> ' + RequestVal);
        SelectRepo(RequestVal);
      }
      //强制关闭客户端连接
      socket.destroy();
    });
  }
);

console.log('Boot Server Starting...');
chatServer.on('connection', function (client) {
  console.log(client.remoteAddress + ': Clent Connection Server');
  if (isAllow(client.remoteAddress)) {
    client.write(Encrypt(secret_key)); // 服务端向客户端发送密匙表明验证服务器.
  } else {
    console.log(client.remoteAddress + ': Denied Access');
    //强制关闭客户端连接
    client.destroy();
  }

});


chatServer.listen(server_port, server_addr);