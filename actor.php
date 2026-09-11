<?php require __DIR__ . '/render.php'; rat_render('actor.html', null, isset($_GET['id']) ? (string)$_GET['id'] : '');
