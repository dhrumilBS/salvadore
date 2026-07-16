<?php
require_once __DIR__ . '/auth.php';

// Already signed in? Go straight to the dashboard.
if (fk_is_logged_in()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = trim($_POST['username'] ?? '');
    $pass = (string) ($_POST['password'] ?? '');

    if (fk_attempt_login($user, $pass)) {
        header('Location: index.php');
        exit;
    }
    $error = 'Invalid username or password.';
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign in · Keyword Finder</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #f4f6fb;
            --surface: #ffffff;
            --border: #e6e9f0;
            --text: #1a2233;
            --text2: #5b6577;
            --text3: #8b94a7;
            --accent: #22a06b;
            --accent2: #3b82f6;
            --danger: #ef4444;
            --radius: 12px;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: 'Inter', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        .login-card {
            width: 100%;
            max-width: 380px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: 0 12px 32px rgba(16, 24, 40, .12);
            padding: 34px 32px 30px;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 26px;
        }

        .brand-icon {
            width: 44px;
            height: 44px;
            border-radius: 11px;
            background: linear-gradient(135deg, #22a06b, #3b82f6);
            display: grid;
            place-items: center;
            font-size: 22px;
        }

        .brand h1 { font-size: 17px; font-weight: 700; }
        .brand span { font-size: 12px; color: var(--text3); }

        .field { margin-bottom: 16px; }

        label {
            display: block;
            font-size: 12.5px;
            font-weight: 600;
            color: var(--text2);
            margin-bottom: 6px;
        }

        input {
            width: 100%;
            padding: 11px 13px;
            font-size: 14px;
            font-family: inherit;
            color: var(--text);
            background: #f7f9fc;
            border: 1px solid var(--border);
            border-radius: 8px;
            transition: border-color .14s, box-shadow .14s;
        }

        input:focus {
            outline: none;
            border-color: var(--accent2);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, .12);
            background: #fff;
        }

        .btn-login {
            width: 100%;
            margin-top: 6px;
            padding: 11px;
            font-size: 14px;
            font-weight: 600;
            font-family: inherit;
            color: #fff;
            background: linear-gradient(135deg, #22a06b, #3b82f6);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: opacity .14s;
        }

        .btn-login:hover { opacity: .92; }

        .error {
            background: rgba(239, 68, 68, .08);
            border: 1px solid rgba(239, 68, 68, .25);
            color: var(--danger);
            font-size: 13px;
            padding: 10px 12px;
            border-radius: 8px;
            margin-bottom: 18px;
        }
    </style>
</head>

<body>
    <form class="login-card" method="post" action="login.php" autocomplete="off">
        <div class="brand">
            <div class="brand-icon">🔍</div>
            <div>
                <h1>Keyword Finder</h1>
                <span>Sign in to continue</span>
            </div>
        </div>

        <?php if ($error !== ''): ?>
            <div class="error"><?= htmlspecialchars($error, ENT_QUOTES) ?></div>
        <?php endif; ?>

        <div class="field">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" required autofocus
                   value="<?= htmlspecialchars($_POST['username'] ?? '', ENT_QUOTES) ?>">
        </div>

        <div class="field">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
        </div>

        <button type="submit" class="btn-login">Sign in</button>
    </form>
</body>

</html>
