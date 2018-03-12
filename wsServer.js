'use strict';
const http = require('http')
const fs = require('fs')
const crypto = require('crypto')

const clientjs = fs.readFileSync('./client.js')
const css = fs.readFileSync('./style.css')
const html = fs.readFileSync('./index.html')

const server = http.createServer((req, res) => {
  req.setEncoding('utf8');
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
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.write(html)
    res.end()
  } else {
    res.statusCode = 404
    res.end()
  }

})

// websocket用サーバ
const wsServer = http.createServer((req, res) => {
  req.setEncoding('utf8');
  res.write('websocket')
  res.end()
});

let count = 0
// WebSocket opening ハンドシェイクする
// upgradeイベント時
wsServer.on('upgrade', (req, socket, head) => {
  // Sec-WebSocket-Accept: xxxxxxx
  // wsでupgrade要求時のreqのheadersにある'sec-websocket-key': 'q+LpZmf2Fosi+7hfcWwkPw=='を使ってkeyを作成する
  console.log('on upgrade is called')
  console.log(req.headers)
  /*
  const hwm = socket._writableState.highWaterMark
  console.log(`hwm: ${hwm}`)
  */
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
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
               'Upgrade: WebSocket\r\n' +
               'Connection: Upgrade\r\n' +
               'Sec-WebSocket-Accept: ' + acceptKey +'\r\n' +
               'Sec-WebSocket-Protocol' + wsProtocol + '\r\n' +
               '\r\n'
              )

  socket.on('sendClient', (data) => {

    console.log('=== sendClient event')
    // fin:1 なのでデータを返す
    // opcodeの4bitの処理する
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
      // TODO: コレ以外はすべてWSを破棄しないといけない（RFC6455
    }
    console.log(`payload: ${payload}`)

    if(payload === 'close') {
      // close時には終端の制御フレームを送る
      console.log('---- payload is close... ----')
      let sendData = Buffer.alloc(2);
      // FIN: 1, rsv1-3: 0, opecode: 0x8でcloseを伝える
      // -> 1000 100(-> 0x88)で送る
      sendData[0] = 0x81;
      socket.write(sendData)
      return;
    }
    // マスク： 1 ビット をとく
    // 先頭1bitが1だったらmaskされている
    const isMasked = Boolean(data[1] & 0x80)
/*
    console.log('----isMasked----')
    console.log(isMasked)
    console.log('----isMasked----')
*/
    // ブラウザからのデータはマスクされているはずなので、何もせず返す
    if(!isMasked) return

    // ペイロード長さを解く
    //  7, 7+16, 7+64 ビットのいずれかになる（ってどうやってとくんだ）
    // 125までの場合はそのまま使う
    // 7Eの場合は16bit読む / 7Fの場合は64bit読む？
    /*
       frame-payload-length
       = ( %x00-7D )   ; 長さ 7 ビット
       / ( %x7E frame-payload-length-16 )  ; 長さ 7+16 ビット
       / ( %x7F frame-payload-length-63 )  ; 長さ 7+64 ビット
    */

    let payloadLength = (data[1] & 0x7f)

    console.log('-- payload length --')
    console.log(payloadLength)
    if (payloadLength === 0x7e) {
      console.log('payload to 16BE')
      // payloadLength = data.readUInt16BE(2)
    } else if (payloadLength === 0x7f) {
      console.log('payload to 64BE')
      // payloadLength = data.readUInt64BE(2)
    }

    // マスク用キー ： 0 バイトまたは 4 バイト
    // フレームの中に包含された 32 ビット値によりマスクされる
    // 在るのは frame-masked が 1 のときに限るが、0の場合は上でreturn済み
    const maskingKey_buf = data.slice(2,6)
    const masking_test = data.readUInt32BE(2)

    // ペイロードデータ（Payload data: (x+y) bytes）が以下が連結されたデータとして存在する
    // 拡張データ + アプリデータ
    const extentionData = 0
    // const applicationData = ペイロードデータ長-拡張データ
    const applicationDataLen = payloadLength - extentionData
    const applicationData_buf = data.slice(6, applicationDataLen + 6)
//    console.log(`applicationDataLen is ${applicationDataLen}`)

    console.log('nodesupport: applicationData')
    console.log(applicationData_buf)
    console.log(maskingKey_buf)
    console.log('masking_test')
    console.log(masking_test)


    let plaintext_buf = Buffer.alloc(applicationDataLen)
    for(let i = 0; i < applicationData_buf.length; i++) {
      plaintext_buf[i] = applicationData_buf[i] ^ maskingKey_buf[i%4]
      console.log(plaintext_buf[i])
    }

    console.log(plaintext_buf)
    console.log(`アンマスクデータ: ${plaintext_buf.toString()}`)
    let unmaskedLen = plaintext_buf.length
    // socketに書いて渡す
    let sendData = Buffer.alloc(unmaskedLen + 2);
    // let sendData = Buffer.alloc(applicationDataLen + 2);
    // FIN: 1, rsv1-3: 0, opecode: 0x1としてtext data限定とする -> 1000 0001(-> 0x81)で送る
    sendData[0] = 0x81
    // クライアントに送るのはマスクしないので MASK:0, payload: plaintext_bufを利用（16進数)
    // 0 +
    sendData[1] = '0x' + plaintext_buf.length.toString(16)
    console.log('sendData[1]')
    console.log(plaintext_buf.length)
    console.log(sendData[1])
    console.log('/sendData[1]')
    for (let i = 0; i < plaintext_buf.length; i++) {
      sendData[2+i] = plaintext_buf[i]
    }
    /*
    console.log('sendData')
    console.log(sendData)
*/
    // to Client
    socket.write(sendData)
  })

  let dataList = ''
  // clientからdata受け取ったときのイベント
  socket.on('data', function(data) {
    count++
    console.log('/** data received **/ : count is ' + count)

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
    const isFin = (data[0] & fincode) === 128

    if(isFin) {
      console.log('send to client event fired')
      dataList = data
      socket.emit('sendClient', dataList);
      dataList = ''
    } else {
      console.log('fincode is not finished...');
      console.log(data[0]);

      // todo:一旦実装なし
      // = %x0 ; このメッセージに後続するフレームがある　場合に該当するので次が来るまでchunkにためておく・・？
    }

  })
  // socket.pipe(socket) // echo backさせる
})

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`listen on ${PORT}`)
});


// Websocket用のサーバスタート
const WSPORT = 8081;
wsServer.listen(WSPORT, () => {
  console.log(`listen on ${WSPORT}`)
});
