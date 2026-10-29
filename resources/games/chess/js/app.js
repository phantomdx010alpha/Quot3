/*
 * Quot3 Chess controller (written for Quot3, MIT). Uses chess.js (Chess), chessboard.js (Chessboard), jQuery and engine.js (chooseMove).
 * Offline: no network, no storage. Computer opponent runs on this page's main thread (levels 1-4 = search depth 1-4).
 */
(function () {
  'use strict';
  var game = new Chess();
  var board = null;
  var thinkTimer = null;
  var humanColor = 'w'; // only used in computer mode
  var $ = window.jQuery;

  var el = {
    mode: $('#mode'), side: $('#side'), level: $('#level'), promo: $('#promo'),
    status: $('#status'), moves: $('#moves'), undo: $('#undoBtn'), newBtn: $('#newBtn'), flip: $('#flipBtn'),
    sideRow: $('#side, #sideLabel'), levelRow: $('#level, #levelLabel')
  };

  function vsComputer() { return el.mode.val() === 'computer'; }
  function sideName(c) { return c === 'w' ? 'White' : 'Black'; }
  function clearMark(cls) { $('#board .square-55d63').removeClass(cls); }

  function markLast() {
    clearMark('highlight-last');
    var h = game.history({ verbose: true });
    if (h.length) {
      var m = h[h.length - 1];
      $('#board .square-' + m.from).addClass('highlight-last');
      $('#board .square-' + m.to).addClass('highlight-last');
    }
  }

  function markCheck() {
    clearMark('highlight-check');
    if (game.in_check() && !game.in_checkmate()) {
      var turn = game.turn();
      var b = game.board();
      for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
        var p = b[r][f];
        if (p && p.type === 'k' && p.color === turn) $('#board .square-' + 'abcdefgh'[f] + (8 - r)).addClass('highlight-check');
      }
    }
  }

  function renderMoves() {
    var h = game.history();
    var html = '';
    for (var i = 0; i < h.length; i += 2) {
      html += '<li><span class="n">' + (i / 2 + 1) + '.</span><span>' + h[i] + '</span><span>' + (h[i + 1] || '') + '</span></li>';
    }
    el.moves.html(html);
    el.moves.scrollTop(el.moves[0].scrollHeight);
  }

  function statusText() {
    var turn = game.turn();
    if (game.in_checkmate()) return 'Checkmate. ' + sideName(turn === 'w' ? 'b' : 'w') + ' wins.';
    if (game.in_stalemate()) return 'Draw by stalemate.';
    if (game.insufficient_material()) return 'Draw: not enough pieces left to checkmate.';
    if (game.in_threefold_repetition()) return 'Draw by threefold repetition.';
    if (game.in_draw()) return 'Draw by the fifty-move rule.';
    var s = sideName(turn) + ' to move.';
    if (game.in_check()) s = sideName(turn) + ' is in check. ' + s;
    if (vsComputer()) s += turn === humanColor ? ' Your turn.' : ' The computer is thinking...';
    return s;
  }

  function refresh() {
    board.position(game.fen());
    markLast();
    markCheck();
    renderMoves();
    el.status.text(statusText());
    el.undo.prop('disabled', game.history().length === 0);
  }

  function isComputerTurn() { return vsComputer() && !game.game_over() && game.turn() !== humanColor; }

  function scheduleComputer() {
    cancelComputer();
    if (!isComputerTurn()) return;
    thinkTimer = window.setTimeout(function () {
      thinkTimer = null;
      var move = chooseMove(game, game.turn(), parseInt(el.level.val(), 10));
      if (move) game.move(move);
      refresh();
    }, 80);
  }

  function cancelComputer() {
    if (thinkTimer) { window.clearTimeout(thinkTimer); thinkTimer = null; }
  }

  function newGame() {
    cancelComputer();
    game = new Chess();
    var s = el.side.val();
    humanColor = s === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : s;
    board.orientation(vsComputer() && humanColor === 'b' ? 'black' : 'white');
    refresh();
    scheduleComputer();
  }

  function undo() {
    cancelComputer();
    if (!game.history().length) return;
    if (vsComputer()) {
      // take back until it is the human's turn again (the computer's reply and the human's move)
      do { game.undo(); } while (game.history().length && game.turn() !== humanColor);
    } else {
      game.undo();
    }
    refresh();
    scheduleComputer();
  }

  function onDragStart(source, piece) {
    if (game.game_over() || thinkTimer) return false;
    var color = piece.charAt(0);
    if (color !== game.turn()) return false;
    if (vsComputer() && color !== humanColor) return false;
  }

  function onDrop(source, target) {
    clearMark('highlight-hint');
    var move = game.move({ from: source, to: target, promotion: el.promo.val() });
    if (move === null) return 'snapback';
    refresh();
    scheduleComputer();
  }

  function onSnapEnd() { board.position(game.fen()); }

  function onMouseoverSquare(square, piece) {
    if (!piece || game.game_over() || thinkTimer) return;
    if (piece.charAt(0) !== game.turn()) return;
    if (vsComputer() && piece.charAt(0) !== humanColor) return;
    var moves = game.moves({ square: square, verbose: true });
    if (!moves.length) return;
    $('#board .square-' + square).addClass('highlight-hint');
    for (var i = 0; i < moves.length; i++) $('#board .square-' + moves[i].to).addClass('highlight-hint');
  }

  function onMouseoutSquare() { clearMark('highlight-hint'); }

  function syncControls() {
    var c = vsComputer();
    el.sideRow.toggle(c);
    el.levelRow.toggle(c);
  }

  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    pieceTheme: 'img/pieces/{piece}.svg',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    onMouseoverSquare: onMouseoverSquare,
    onMouseoutSquare: onMouseoutSquare
  });

  el.mode.on('change', function () { syncControls(); newGame(); });
  el.side.on('change', newGame);
  el.level.on('change', function () { /* applies to the computer's next move */ });
  el.newBtn.on('click', newGame);
  el.undo.on('click', undo);
  el.flip.on('click', function () { board.flip(); markLast(); markCheck(); });
  $(window).on('resize', function () { board.resize(); markLast(); markCheck(); });

  syncControls();
  refresh();
})();
