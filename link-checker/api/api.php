<?php
require_once("Rest.inc.php");

class API extends REST
{
	private $token;
	private $db = NULL;

	private $DB_CONFIGS = [
		'healthray' => [
			'label' => 'Healthray',
			'host' => '143.110.176.144',
			'name' => 'wp_healthray_landing',       // ← change to your actual DB name
			'user' => 'office_landing',     // ← change to your actual DB user
			'pass' => 'Health@L@N-DB4({^&*8*U&Jg6J6P', // ← change to your actual password
			'prefix' => 'wp_',
		],

		'botphonic' => [
			'label' => 'Botphonic',
			'host' => '52.5.152.133',
			'name' => 'wp_botphonic_landing',
			'user' => 'office_landing',
			'pass' => 'BOT@phoL@NDB({^&*U&Jg6J6P',
			'prefix' => 'wp_',
		],
	];

	public function __construct()
	{
		parent::__construct();
		$defaultKey = array_key_first($this->DB_CONFIGS);
		$db = $this->getDbConnection($defaultKey);
		$this->db = $db['conn'];
	}


	private function getDbConnection(string $key): array
	{
		$configs = $this->DB_CONFIGS;
		if (!isset($configs[$key])) {
			$result = ['success' => false, 'error' => "Unknown site key: {$key}"];
			$this->response($this->json($result), 400);
		}
		$cfg = $configs[$key];
		$conn = new mysqli($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['name']);
		if ($conn->connect_error) {
			$result = ['success' => false, 'error' => 'DB connection failed: ' . $conn->connect_error];
			$this->response($this->json($result), 500);
		}
		$conn->set_charset('utf8mb4');
		return ['conn' => $conn, 'prefix' => $cfg['prefix'], 'label' => $cfg['label']];
	}

	public function getSiteList(): array
	{
		$out = [];
		foreach ($this->DB_CONFIGS as $key => $cfg) {
			$out[] = ['key' => $key, 'label' => $cfg['label']];
		}
		return $out;
	}

	public function getPostStatus(): array
	{
		$out = [
			"publish" => "Published",
			"draft" => "Draft",
			"trash" => "Trash"
		];
		return $out;
	}

	public function resolveDbKey(): string
	{
		$key = trim($_POST['db_key'] ?? '');
		return isset($this->DB_CONFIGS[$key]) ? $key : array_key_first($this->DB_CONFIGS);
	}

	private function get_sites()
	{
		if ($this->get_request_method() != "GET") {
			$result = [
				'success' => false,
				'error' => 'Change Method to GET'
			];
			$this->response($this->json($result), 406);
		}

		$result = [
			'success' => true,
			'data' => $this->getSiteList()
		];

		$this->response($this->json($result), 200);
	}

	private function get_post_status()
	{
		if ($this->get_request_method() != "GET") {
			$result = [
				'success' => false,
				'error' => 'Change Method to GET'
			];
			$this->response($this->json($result), 406);
		}

		$result = [
			'success' => true,
			'data' => $this->getPostStatus()
		];

		$this->response($this->json($result), 200);
	}

	public function token(): string
	{
		return "Bearer " . bin2hex(random_bytes(32));
	}


	public function processApi()
	{
		$func = strtolower(trim(str_replace("/", "", $_REQUEST['rquest'])));
		if ((int) method_exists($this, $func) > 0)
			$this->$func();
		else
			$result = [];
		$this->response($result, 404);			// If the method not exist with in this class, response would be "Page not found".
	}


	// ********************************************* //
	// ****************  For GEt Posts  **************** //
	// ********************************************* //

	private function get_posts()
	{
		if ($this->get_request_method() != "POST") {
			$result = [
				'success' => false,
				'method' => $this->get_request_method(),
				'error' => 'Change Method to POST'
			];
			$this->response($this->json($result), 406);
		}

		$key = $this->resolveDbKey();
		$db = $this->getDbConnection($key);

		$conn = $db['conn'];
		$prefix = $db['prefix'];

		$postType = trim($_POST['post_type'] ?? 'post');
		$postStatus = trim($_POST['post_status'] ?? 'publish');

		if (empty($postType)) {
			$result = [
				'success' => true,
				'data' => [],
				'site_key' => $key,
				'site_label' => $db['label'],
				'total' => 0
			];
			$this->response($this->json($result), 200);
		}

		if (empty($postStatus)) {
			$result = [
				'success' => true,
				'data' => [],
				'site_key' => $key,
				'site_label' => $db['label'],
				'total' => 0
			];
			$this->response($this->json($result), 200);
		}

		$stmt = $conn->prepare(
			"SELECT 
            ID, post_title, post_name, post_date, post_content, guid, post_status FROM {$prefix}posts
        WHERE post_status = ?
          AND post_type = ?
        ORDER BY post_date DESC"
		);

		$stmt->bind_param('ss', $postStatus, $postType);
		$stmt->execute();
		$res = $stmt->get_result();

		$rows = [];

		while ($row = $res->fetch_assoc()) {
			$rows[] = [
				'ID' => (int) $row['ID'],
				'post_title' => $row['post_title'],
				'post_name' => $row['post_name'],
				'post_date' => $row['post_date'],
				'post_content' => $row['post_content'],
				'post_status' => $row['post_status'],
				'guid' => $row['guid'],
			];
		}

		$result = [
			'success' => true,
			'msg' => 'Posts fetched successfully.',
			'data' => $rows,
			'site_key' => $key,
			'site_label' => $db['label'],
			'total' => count($rows),
		];

		$stmt->close();
		$conn->close();

		$this->response($this->json($result), 200);
	}

	// ********************************************* //
	// ***********  For Post type  *********** //
	// ********************************************* //

	private function get_post_types()
	{
		if ($this->get_request_method() != "POST") {
			$result = [
				'success' => false,
				'method' => $this->get_request_method(),
				'error' => 'Change Method to POST'
			];
			$this->response($this->json($result), 406);
		}

		$key = $this->resolveDbKey();
		$db = $this->getDbConnection($key);

		$post_types = ['post', 'page'];

		$result = [
			'success' => true,
			'msg' => 'Post types fetched successfully.',
			'post_types' => $post_types,
			'site_key' => $key,
			'site_label' => $db['label'],
			'total' => count($post_types),
		];

		$this->response($this->json($result), 200);
	}

	// ********************************************* //
	// ***********  For Cards  *********** //
	// ********************************************* //


	private function json($data)
	{
		if (is_array($data)) {
			return json_encode($data, JSON_NUMERIC_CHECK);
		}
	}
}
$api = new API;
$api->processApi();
