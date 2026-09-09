<?php require __DIR__ . '/render.php'; rat_render('play.html', isset($_GET['id']) ? (string)$_GET['id'] : '');
