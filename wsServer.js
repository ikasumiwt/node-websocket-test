'use strict';
const http = require('http')
const fs = require('fs')
const crypto = require('crypto')

const clientjs = fs.readFileSync('./client.js')
const css = fs.readFileSync('./style.css')

const server = http.createServer((req, res) => {
  
  console.log(req.url)
  // 雑なので気力が残っていれば直す /style.css /client.js 

  if (req.url === '/style.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' })
    res.write(css)
    res.end()
    return
  } else if (req.url === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' })
    res.write(clientjs)
    res.end()
    return
  }

  const filename = './index.html'
  fs.readFile(filename, (err, file) => {
    if(err) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('something happened')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.write(file)
    res.end()
  })
})


// WebSocket opening ハンドシェイクする

// upgradeイベント時
server.on('upgrade', (req, socket, head) => {
  // Sec-WebSocket-Accept: xxxxxxx
  // wsでupgrade要求時のreqのheadersにある'sec-websocket-key': 'q+LpZmf2Fosi+7hfcWwkPw=='を使ってkeyを作成する
  console.log('on upgrade is called')
  console.log(req.headers)


  // keyからacceptヘッダーを作成する
  // 一旦日本語で読んだ https://triple-underscore.github.io/RFC6455-ja.html
  // Sec-WebSocket-Accept ヘッダ — その値には、［ 上で定義した キー からハッシュを構築した結果 ］をあてがう。
  // 定義は以下
  // sec-websocket-keyの値に "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" を付与
  // これにsha1 hashを使う
  // base64で符号化する

  let wsProtocol = ''
  let acceptKey = ''
  
  if(req.headers['sec-websocket-protocol']) {
     wsProtocol = req.headers['sec-websocket-protocol'].split(',')[0]
  }
  console.log('-- wsProtocol --')
  console.log(wsProtocol)
  if(!req.headers['sec-websocket-key']) {
    console.log('error sec-websocket-key is not found')
    return
  } else {
    const key = req.headers['sec-websocket-key']
    acceptKey = crypto.createHash('sha1')
                .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                .digest('base64')
  }

  // responseヘッダ返す
  // status line 
  // headers
  // (headersの中にwebsocketまわりを追加
  socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n' +
               'Upgrade: WebSocket\r\n' +
               'Connection: Upgrade\r\n' +
               'Sec-WebSocket-Accept: ' + acceptKey +'\r\n' +
               'Sec-WebSocket-Protocol' + wsProtocol + '\r\n' +
               '\r\n'
              )

  // clientからdata受け取ったときのイベント
  socket.on('data', function(data) {
    console.log('/** data received **/')
    console.log(data)
    console.log(data[1])
    console.log(data.length)

  // FIN:の1bitを処理
/*
Indicates that this is the final fragment in a message. The first fragment MAY also be the final fragment.
??: rsv1-3は0にされなければならないので、つまり0x81だったらfinでいい？（それ以外は0ではないのが入ってるので
--- data received--
<Buffer 81 84 5c 1b 93 cf 28 7e e0 bb>
10
--- data received--
<Buffer 81 fe 17 70 56 75 fa f2 67 44 cb c3 67 44 cb c3 67 44 c8 c0 64 47 c8 c0 64 47 c8 c0 67 44 cb c3 67 44 cb c3 67 44 c8 c0 64 47 c8 c0 64 47 c8 c0 67 44 ... >
6008
--- data received--
<Buffer 7c 04 44 76 7c 04 44 76 7f 07 47 75 7f 07 47 75 7f 07 44 76 7c 04 44 76 7c 04 44 76 7f 07 47 75 7f 07 47 75 7f 07 44 76 7c 04 44 76 7c 04 44 76 7f 07 ... >
16078
--- data received--
<Buffer 81 fe 62 70 16 7f 5b ff 27 4e 6a ce 27 4e 6a ce 27 4e 69 cd 24 4d 69 cd 24 4d 69 cd 27 4e 6a ce 27 4e 6a ce 27 4e 69 cd 24 4d 69 cd 24 4d 69 cd 27 4e ... >
25208
*/
// ?? : RSVとは / 今回は0前提とする
    const fincode = 0x80
    console.log('-- fincode --')
    console.log(fincode & fincode)
    if(data[0] & fincode === 128) {
      // fin:1 なのでデータを返す
      // opcode: 4bitの処理する
      const opcode = data[0] & 0x0f
      let payload = ''
      switch (opcode) {
        case 0x0:
          payload = 'continuation'
          break;
        case 0x1:
          payload = 'text'
          break;
        case 0x2:
          payload = 'binary'
          break;
        case 0x8:
          payload = 'close'
          break;
        case 0x9:
          payload = 'ping'
          break;
        case 0xA:
          payload = 'pong'
          break;
      }
      console.log(payload)
      // マスク： 1 ビット をとく
      // 先頭1bitが1だったらmaskされている
      const isMasked = Boolean(data[1] & 0x80)

      console.log('----isMasked----')
      console.log(isMasked)
      // ブラウザからのデータはマスクされているはずなので、何もせず返す
      if(!isMasked) return 

      // ペイロード長さを解く
      //  7, 7+16, 7+64 ビットのいずれかになる（ってどうやってとくんだ）
      // 125までの場合はそのまま使う
      // 7Eの場合は16bit読む
      // 7Fの場合は64bit読む？
      /*
         frame-payload-length
         = ( %x00-7D )   ; 長さ 7 ビット
         / ( %x7E frame-payload-length-16 )  ; 長さ 7+16 ビット
         / ( %x7F frame-payload-length-63 )  ; 長さ 7+64 ビット
      */

      let payloadLength = data[1] & 0x7f
      console.log('-- payload length --')
      console.log(payloadLength)

      if (payloadLength === 0x7e) {
        console.log('payload to 16BE')
        // payloadLength = data.readUInt16BE(2)
      } else if (payloadLength === 0x7f) {
        console.log('payload to 64BE')
        // payloadLength = data.readUInt64BE(2)
      }

      // TODO このあたりからうまくいかないので一旦
      // /WebSocket-Node/blob/master/lib/WebSocketFrame.js#L84


      // マスク用キー ： 0 バイトまたは 4 バイト
      // フレームの中に包含された 32 ビット値によりマスクされる
      // 在るのは frame-masked が 1 のときに限るが、0の場合は上でreturn済み
      const maskingKey = data.readUInt32BE(2)


      // ペイロードデータ（Payload data: (x+y) bytes）が以下が連結されたデータとして存在する
      // 拡張データ + アプリデータ
      // 拡張データは、拡張が折衝されていない限り， 0 バイトになる。らしいので0?
      const extentionData = 0

      // const applicationData = ペイロードデータ長-拡張データ
      const applicationDataLen = payloadLength - extentionData
      console.log('app data len : ' + applicationDataLen)

      const applicationData = data.readUInt32BE(applicationDataLen)

      // maskを外す
      const unmasked = applicationData ^ maskingKey;

      console.log('--- unmasked ---')
      console.log(unmasked)

      // socketに書いて渡す
      // 書き込み用バッファ作成
      // 一旦okと返す
//      let writeBuf = Buffer.alloc(applicationDataLen)
//      writeBuf.writeUInt32BE(unmasked, 0)
      let encodedStr = 'ok' // writeBuf.toString()
      // 
      let sendData = Buffer.alloc(4)// Buffer.alloc(applicationDataLen + 2);
      sendData[0] = 0x81
      // okの2文字だけ
      sendData[1] = 0x2

      // for (let i; i < applicationDataLen; i++) {
      //  sendData[2+i] = encodedStr.charCodeAt(i)
      //}
      sendData[2] = encodedStr.charCodeAt(0)
      sendData[3] = encodedStr.charCodeAt(1)
      console.log('sendData')
      console.log(sendData)
      
      // to Client
      socket.write(sendData)

    } else {
      // todo:一旦実装なし
      // = %x0 ; このメッセージに後続するフレームがある　場合に該当するので次が来るまでchunkにためておく・・？
    }
    // clientに返す
    // maskしていないと以下のように怒られる
    // WebSocket connection to 'ws://localhost:8080/chat' failed: A server must not mask any frames that it sends to the client.
    // socket.write(data)
    //socket.end(data);
  })
  // socket.pipe(socket) // echo backさせる
})

/* TODO: web serverにのせる
GET /resource HTTP/1.1
Host: node-websocket-test.appspot.com
Upgrade: websocket
Connection: upgrade
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: xxxxxx
*/

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`listen on ${PORT}`)
})



