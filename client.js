$(function() {
  var FADE_TIME = 150; // ms
  var TYPING_TIMER_LENGTH = 400; // ms

  // Initialize variables
  var $window = $(window)

  // https://developer.mozilla.org/ja/docs/Web/API/WebSocket
  var isLocal = true
  var url = isLocal ? 'localhost:8080/' : 'node-websocket-test.appspot.com/'

  var ws = new WebSocket('ws://' + url + 'chat')

  ws.onopen = function () {
    console.log('-- websocket is open --')
    console.log(ws)

    // openできたら送ってみる
    // ws.send('test')
    // websocketでサーバからメッセージを受信したときのリスナ
    ws.onmessage = function (msg) {
      console.log('on msg event')
      console.log(msg.data)
      $('ul.messages').append('<li> data received:' + msg.data + '</li>');
    }

    ws.onerror = function (err) {
      console.log('on error')
      console.log(err)
    }
  }

  // msg送信
  sendMessage = function() {
    var msg = $('.inputMessage').val()
    if(msg !== '') {
      ws.send(msg)
      $('.inputMessage').val('')
    } else {
      alert('no message in input form')
    }
  }

  $('.inputMessage').keypress(function (e) {
	if ( e.which == 13 ) {
		// ここに処理を記述
    sendMessage()
		return false;
	}
  } );
});
