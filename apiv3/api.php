<?php
require_once("Rest.inc.php");
// require_once("../admin/function.php"); // for Ratio

class API extends REST
{

	public $data = "";
	private $db = NULL;
	public function __construct()
	{
		parent::__construct();				// Init parent contructor
		$this->dbConnect();					// Initiate Database connection
		$token = $this->token();
	}

	private function dbConnect() // Database Connection
	{
		foreach (getallheaders() as $name => $value) {
			$key = null;
			if ($name == 'Auth-Key') {
				$key = $value;
				break;
			}
		}
		// if ($key == '' || $key !== 'uej7xt78') {
		// 	echo json_encode(array("success" => false, "error" => "Failed to verify key."));
		// 	exit;
		// }
		$this->db = mysqli_connect('143.110.176.144', 'office_landing', 'Health@L@N-DB4({^&*8*U&Jg6J6P', 'wp_healthray_landing');
	}

	public function token()
	{
		$token = "Bearer " . bin2hex(random_bytes(32));
		return $token;
	}


	public function processApi()
	{
		$func = strtolower(trim(str_replace("/", "", $_REQUEST['rquest'])));
		if ((int)method_exists($this, $func) > 0)
			$this->$func();
		else
			$result = [];
		$this->response($result, 404);			// If the method not exist with in this class, response would be "Page not found".
	}

	private function gratify($list)
	{
		$list = explode(' ', $list);
		$list = implode(",", $list);

		$sql = "SELECT " . $list . " FROM wp_posts ";
		$op = $this->db->query($sql);
		$ap = $op->fetch_assoc();
		$result = ['success' => false,  'msg' => $ap, $list];
		$this->response($this->json($result), 200);
	}
	private function getuser()
	{
		return $this->gratify('gratify_user_fname gratify_user_lname');
	}


	// ********************************************* //
	// ****************  For Users  **************** //
	// ********************************************* //

	private function user()   // 4. User Listing
	{
		if ($this->get_request_method() != "GET") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to GET"];
			$this->response($this->json($result), 406);
		}

		if (!empty($_GET['post_id'])) {
			$post_id = $_GET['post_id'];
			$res = $this->db->query("SELECT id,post_title,post_name,post_status FROM wp_posts WHERE id='{$post_id}'");
			if (mysqli_num_rows($res) > 0) {
				while ($rlt = $res->fetch_assoc()) {
					$rlt1[] = $rlt;
				}
				$result = ['success' => true, "msg" => "Listing Successfull to fetch " . mysqli_num_rows($res) . " data.", "data" => $rlt1];
				$this->response($this->json($result), 200);
			}
			$result = ['success' => false, "msg" => "No Content"];
			$this->response($this->json($result), 200);	// If no records "No Content" status
		}
		$result = ['success' => false, "msg" => "Please Provide ID"];
		$this->response($this->json($result), 200);	// If no records "No Content" status	

	}

	// ********************************************* //
	// ***********  For Deleteing Users  *********** //
	// ********************************************* //

	private function gratify_user() // 8. Get all Gratify_Users
	{
		if ($this->get_request_method() != "GET") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to GET"];
			$this->response($this->json($result), 406);
		}

		if (!empty($_GET['post_id'])) {
			$post_id = $_GET['post_id'];
			$res = $this->db->query("SELECT * FROM gratify_user");

			if (mysqli_num_rows($res) > 0) {
				while ($rlt = $res->fetch_assoc()) {
					$rlt1[] = $rlt;
				}
				$result = ['success' => true, "msg" => "List Successfull", "reception_list" => $rlt1];
				$this->response($this->json($result), 200);
			}
			$result = ['success' => false, "msg" => "Not Found"];
			$this->response($this->json($result), 200);	// If no records "No Content" status
		}
		$result = ['success' => false, "msg" => "Please provide GratifyvUser Id"];
		$this->response($this->json($result), 200);
	}

	// ********************************************* //
	// ***********  For Cards  *********** //
	// ********************************************* //

	private function cardsdata() // 8. Get all Gratify_Users
	{
		if ($this->get_request_method() != "GET") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to GET"];
			$this->response($this->json($result), 406);
		}

		$res = $this->db->query("SELECT p.id,p.post_name,p.post_title,p.menu_order,pm.meta_value FROM wp_posts p inner JOin wp_postmeta pm ON(p.id = pm.post_id) WHERE p.post_type = 'page' AND pm.meta_value = 'templates/template-emr-state.php' ORDER BY p.menu_order ASC;");
		if (mysqli_num_rows($res) > 0) {
			while ($card = $res->fetch_assoc()) {
				$id = $card['id'];
				$ap1 = $this->db->query("SELECT p.id,p.post_name,p.post_title,p.menu_order,pm.meta_value FROM wp_posts p inner JOIN wp_postmeta pm ON (p.id = pm.post_id) WHERE pm.meta_key='state_name_link' AND pm.meta_value = '$id' AND p.post_type = 'page' ORDER BY p.menu_order ASC;");
				$temp_array = [];
				while ($text = $ap1->fetch_assoc()) {
					$temp_array[] = $text;
				}
				$card["textdata"] = $temp_array;
				$carddata[] = $card;
			}
			$result = ['success' => true, "msg" => "List Successfull", "data" => $carddata];
			$this->response($this->json($result), 200);
		}

		$result = ['success' => false, "msg" => "Not Found"];
		$this->response($this->json($result), 200);	// If no records "No Content" status

	}

	private function category() // 8. Get all Gratify_Users
	{
		if ($this->get_request_method() != "GET") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to GET"];
			$this->response($this->json($result), 406);
		}

		$ap = $this->db->query("SELECT * FROM category WHERE status = 1");
		while ($cat = $ap->fetch_assoc()) {
			if ($cat['status'] == 1) {
				$cat['status'] = true;
			} else {
				$cat['status'] = false;
			}
			$cat_data[] = $cat;
		}
		$result = ["success" => true, "msg" => "listing successful.", "category" => $cat_data];
		$this->response($this->json($result), 200);
	}

	private function json($data)
	{
		if (is_array($data)) {
			return json_encode($data, JSON_NUMERIC_CHECK);
		}
	}
}
$api = new API;
$api->processApi();
/*
1.  http://192.168.31.46:8080/website/gratifyV2/api/login
1. 
2.  http://192.168.31.46:8080/website/gratifyV2/api/gratifyusersignup
2. 
3.  http://192.168.31.46:8080/website/gratifyV2/api/gratifyuserupdate
3. 
4.  http://192.168.31.46:8080/website/gratifyV2/api/user
4. 
5.  http://192.168.31.46:8080/website/gratifyV2/api/adduser
5. 
6.  http://192.168.31.46:8080/website/gratifyV2/api/updateuser
6. 
7.  http://192.168.31.46:8080/website/gratifyV2/api/deleteUser
7. 
8.  http://192.168.31.46:8080/website/gratifyV2/api/gratify_user
8. 

 {{localhost}}/api/login
 {{localhost}}/api/gratifyusersignup
 {{localhost}}/api/gratifyuserupdate
 {{localhost}}/api/user
 {{localhost}}/api/adduser
 {{localhost}}/api/updateuser
 {{localhost}}/api/deleteUser
 {{localhost}}/api/gratify_user

*/