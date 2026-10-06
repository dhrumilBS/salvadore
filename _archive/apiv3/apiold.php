<?php
require_once("Rest.inc.php");
require_once("../admin/function.php"); // for Ratio

class API extends REST
{

	public $data = "";
	const DB_SERVER = "localhost";
	// const DB_USER = "root";
	// const DB_PASSWORD = "";
	// const DB = "gratify_v2"; // Original
	const DB_USER = "wckzgmedtk";
	const DB_PASSWORD = "rtqx7BXQuN";
	const DB = "wckzgmedtk"; // Original
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
		if ($key == '' || $key !== 'uej7xt78') {
			echo json_encode(array("success" => false, "error" => "Failed to verify key."));
			exit;
		}
		$this->db = mysqli_connect(self::DB_SERVER, self::DB_USER, self::DB_PASSWORD, self::DB);
	}

	public function token()
	{
		$token = "Bearer " . bin2hex(random_bytes(32));
		return $token;
	}
	private function header($token)
	{
		$res = $this->db->query("SELECT token FROM gratify_user WHERE token = '$token' AND status = 1");
		if (mysqli_num_rows($res) > 0) {
			$rlt = $res->fetch_assoc();
			$token = $rlt['token'];
			header("Authorization:" . $token);
			$header =  $token;
			return $header;
		} else {
			$result['success'] = false;
			$result['msg'] = "token Not Found";
			return $this->response($this->json($result), 404);
		}
	}

	private function checktoken()
	{
		$header = getallheaders();
		if (isset($header['Authorization'])) {
			$token = $header['Authorization'];
			$res = $this->db->query("SELECT * FROM gratify_user WHERE token= '$token'");

			if ($res->num_rows > 0) {
				$result = ['success' => true, 'token' => $token];
			} else {
				$result = ['success' => false, 'msg' => 'Please Verify Token', 'token' => $token];
			}
			return ($result);
		}
		$result = ['success' => false,  'error' => "Please Set Authorization"];
		$this->response($this->json($result), 200);
	}
	private function version()
	{
		$header = getallheaders();
		if (isset($header['App-Version'])) {
			$app_version = $header['App-Version'];
			$res = $this->db->query("SELECT * FROM gratify_user WHERE app_version = '$app_version'");
			// echo "SELECT * FROM gratify_user WHERE token= '$token'";
			if ($res->num_rows > 0) {
				$result = ['success' => 'true', "app_version" => $app_version];
			} else {
				$token = $this->checktoken()['token'];
				$res = $this->db->query("UPDATE gratify_user SET app_version = '$app_version' WHERE token = '$token'");
				$result = ['success' => 'false', "app_version" => $app_version];
			}
			return ($result);
		}
		$result = ['success' => false,  'error' => "Please provide App version"];
		$this->response($this->json($result), 200);
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
		if (!empty($this->checktoken()['token'])) {
			$token = $this->checktoken()['token'];
			$sql = "SELECT " . $list . " FROM gratify_user WHERE token = '$token'";
			$op = $this->db->query($sql);
			$ap = $op->fetch_assoc();
			$result = ['success' => false,  'msg' => $ap, $list];
			$this->response($this->json($result), 200);
		}
		$result = ['success' => false,  'msg' => "Please Check token"];
		$this->response($this->json($result), 401);
	}
	private function getuser()
	{
		$this->gratify('gratify_user_fname gratify_user_lname');
	}

	// ********************************************* //
	// -------------  For Geatify_user  ------------ //
	// ********************************************* //

	private function login() // 1. Geatify_user Can login
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}
		$token = $this->token();

		if (!empty($this->_request['gratify_user_email'])) {
			if (filter_var($this->_request['gratify_user_email'], FILTER_VALIDATE_EMAIL)) {
				$gratify_user_email = $this->_request['gratify_user_email'];
				if ($this->_request['login_reference_type'] == 3) {
					$login_reference_type =  $this->_request['login_reference_type'];
					if (!empty($this->_request['gratify_user_password'])) {
						$gratify_user_password = $this->_request['gratify_user_password'];
						$res = $this->db->query("SELECT gratify_user_id,gratify_user_fname,gratify_user_lname,gratify_user_birth_date,gratify_profile,gratify_user_email FROM  gratify_user WHERE gratify_user_email = '$gratify_user_email' AND gratify_user_password = '" . md5($gratify_user_password) . "'");
						if (mysqli_num_rows($res) > 0) {
							$result = mysqli_fetch_array($res, MYSQLI_ASSOC);
							$result['gratify_user_birth_date'] = date('d-m-Y', strtotime($result['gratify_user_birth_date']));

							$res1 = $this->db->query("UPDATE gratify_user SET token ='$token',last_login_date=NOW() WHERE gratify_user_email = '$gratify_user_email'");
							$this->header($token);
							$result = ['success' => true, "msg" => "Login SuccessFull", 'token' => $token, "id" => $result['gratify_user_id'], "data" => $result];
							$this->response($this->json($result), 200);
						}
						$result = ['success' => false, "msg" => "Please Check Your Email ID Or Password!"];
						$this->response($this->json($result), 200);
					}
					$error = array('success' => false, "msg" => "Check Your Password");
					$this->response($this->json($error), 400);
				} elseif ($this->_request['login_reference_type']  == 1 || $this->_request['login_reference_type']  ==  2) {
					if (!empty($this->_request['login_reference_id'])) {
						$login_reference_type = $this->_request['login_reference_type'];
						$res = $this->db->query("SELECT * FROM gratify_user WHERE gratify_user_email = '$gratify_user_email' AND login_reference_type='$login_reference_type'");
						if (mysqli_num_rows($res) > 0) {
							$result = mysqli_fetch_array($res, MYSQLI_ASSOC);
							$res = $this->db->query("UPDATE gratify_user SET token = '$token',last_login_date=NOW() WHERE gratify_user_email = '$gratify_user_email'");
							$this->header($token);
							$result = ['success' => true, "msg" => "Login Successfully", 'token' => $token, "id" => $result['gratify_user_id']];
							$this->response($this->json($result), 200);
						}
						$result = ['success' => false, "msg" => "Please Sign Up First!"];
						$this->response($this->json($result), 200);
					}
					$error = array('success' => false, "msg" => "Reference ID is not provided");
					$this->response($this->json($error), 400);
				}
				$error = array('success' => false, "msg" => "Invalid Reference");
				$this->response($this->json($error), 401);
			}
			$error = array('success' => false, "msg" => "Provide Correct Email ID");
			$this->response($this->json($error), 401);
		}
		$error = array('success' => false, "msg" => "Email ID is Required");
		$this->response($this->json($error), 401);
	}

	private function gratifyusersignup() // 2. Geatify_user Create Account
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}
		$token = $this->token();
		if (!empty($this->_request['gratify_user_email'])) {
			$gratify_user_email = $this->_request['gratify_user_email'];
			if (filter_var($gratify_user_email, FILTER_VALIDATE_EMAIL)) {
				$gratify_user_fname = $this->_request['gratify_user_fname'];
				$gratify_user_lname = $this->_request['gratify_user_lname'];
				if ($this->_request['login_reference_type'] == 3) {
					$login_reference_type =  $this->_request['login_reference_type'];
					$gratify_user_password = md5($this->_request['gratify_user_password']);
					$date = $this->_request['gratify_user_birth_date'];
					$gratify_user_birth_date = DATE('Y-m-d', strtotime($date));
					if (!empty($gratify_user_password)) {
						$res = $this->db->query("SELECT * FROM gratify_user WHERE gratify_user_email = '$gratify_user_email' AND login_reference_type = $login_reference_type");
						if (mysqli_num_rows($res) > 0) {
							$result = mysqli_fetch_array($res, MYSQLI_ASSOC);
							$result = ['success' => false, "msg" => "Duplicate Record Found"];
							$this->response($this->json($result), 200);
						}
						$sql = $this->db->query("INSERT INTO gratify_user SET gratify_user_fname = '{$gratify_user_fname}', gratify_user_lname = '{$gratify_user_lname}',gratify_user_birth_date='{$gratify_user_birth_date}',login_reference_id = 3, login_reference_type = 3,token = '$token',gratify_user_email = '{$gratify_user_email}', gratify_user_password = '{$gratify_user_password}',added_date = NOW()");
						$id = mysqli_insert_id($this->db);
						$user = $this->db->query("SELECT gratify_user_fname, gratify_user_lname, gratify_user_birth_date, gratify_profile,gratify_user_email  FROM gratify_user WHERE gratify_user_id = {$id}");
						$rlt = $user->fetch_assoc();
						$rlt['gratify_user_birth_date'] = DATE('d-m-Y', strtotime($rlt['gratify_user_birth_date']));
						$result = ['success' => true, "msg" => "Saved Successfully!", 'token' => $token, "id" => $id, "data" => $rlt];
						$this->response($this->json($result), 200);
					}
					$error = array('success' => false, "msg" => "Invalid gratify_user_Password");
					$this->response($this->json($error), 400);
				} elseif ($this->_request['login_reference_type']  == 1 || $this->_request['login_reference_type']  == 2) {
					if (!empty($this->_request['login_reference_id'])) {
						$login_reference_type = $this->_request['login_reference_type'];
						$login_reference_id = $this->_request['login_reference_id'];
						$res = $this->db->query("SELECT * FROM gratify_user WHERE gratify_user_email = '$gratify_user_email'");
						if (mysqli_num_rows($res) > 0) {
							$result = mysqli_fetch_array($res, MYSQLI_ASSOC);
							$result = ['success' => false, "msg" => "Duplicate Record Found"];
							$this->response($this->json($result), 200);
						}
						$sql = $this->db->query("INSERT INTO gratify_user SET gratify_user_fname = '{$gratify_user_fname}', gratify_user_lname = '{$gratify_user_lname}', login_reference_id = '$login_reference_id', login_reference_type = '$login_reference_type',token = '$token',gratify_user_email = '{$gratify_user_email}', added_date = NOW()");
						$result = ['success' => true, "msg" => "Saved Successfully!", "token" => $token, "id" => mysqli_insert_id($this->db)];
						$this->response($this->json($result), 200);
					}
					$error = array('success' => false, "msg" => "Reference ID is not provided");
					$this->response($this->json($error), 400);
				}
				$error = array('success' => false, "msg" => "Invalid Reference");
				$this->response($this->json($error), 401);
			}
			$error = array('success' => false, "msg" => "Invalid Email");
			$this->response($this->json($error), 400);
		}
		$error = array('success' => false, "msg" => "Please Provide Email ID");
		$this->response($this->json($error), 400);
	}

	private function updateprofile() // 3. Update Geatify_user Details
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}
		if ($this->checktoken()['success'] == true) {
			$this->version();
			$token = $this->checktoken()['token'];
			$date = $this->_request['gratify_user_birth_date'];
			$birthdate =  DATE('Y-m-d', strtotime($date));
			$prof = $this->db->query("SELECT * FROM gratify_user WHERE token='{$token}'")->fetch_assoc();
			$profile = $prof['gratify_user_id'] . ".png";
			$temp_array = $_FILES['gratify_profile']['tmp_name'];
			// echo __FILE__;die;
			if (!empty($this->_request['gratify_user_fname']) && !empty($this->_request['gratify_user_lname'])) {
				$gratify_user_fname = $this->_request['gratify_user_fname'];
				$gratify_user_lname = $this->_request['gratify_user_lname'];

				if (!empty($this->_request['gratify_user_old_password']) && !empty($this->_request['gratify_user_password'])) {
					$gratify_user_password = md5($this->_request['gratify_user_password']);
					$gratify_user_old_password = md5($this->_request['gratify_user_old_password']);
					$res = $this->db->query("SELECT gratify_user_id,gratify_user_fname,gratify_user_lname,gratify_user_birth_date,gratify_profile,gratify_user_email FROM gratify_user WHERE token='{$token}' AND gratify_user_password = '{$gratify_user_old_password}'");
					$rlt = $res->fetch_assoc();
					if (mysqli_num_rows($res) > 0) {
						$this->db->query("UPDATE gratify_user SET gratify_user_fname = '{$gratify_user_fname}', gratify_user_lname = '{$gratify_user_lname}',gratify_user_birth_date ='{$birthdate}',gratify_profile = '{$profile}',gratify_user_birth_date ='{$birthdate}',gratify_user_password = '{$gratify_user_password}',modify_date=NOW() WHERE token='{$token}'");
						move_uploaded_file($_FILES["gratify_profile"]["tmp_name"], "./../admin/upload/" . $profile);
						$rlt['gratify_user_birth_date'] = date('d-m-Y', strtotime($rlt['gratify_user_birth_date']));
						$result = ['success' => true, "msg" => "Update Success data.", "data" => $rlt];
						$this->response($this->json($result), 200);
					}
					$result = ['success' => false, "msg" => "Wrong password. Try again or ‘Forgot password’ to reset it."];
					$this->response($this->json($result), 200);
				}

				$sql = "UPDATE gratify_user SET gratify_user_fname = '{$gratify_user_fname}', gratify_user_lname = '{$gratify_user_lname}',gratify_user_birth_date ='{$birthdate}',gratify_profile = '{$profile}',modify_date=NOW() WHERE token='{$token}'";
				if ($this->db->query($sql)) {
					$res = $this->db->query("SELECT gratify_user_id,gratify_user_fname,gratify_user_lname,gratify_user_birth_date,gratify_profile,gratify_user_email FROM gratify_user WHERE token='{$token}'");
					if (mysqli_num_rows($res) > 0) {
						$rlt = $res->fetch_assoc();
						$rlt['gratify_user_birth_date'] = date('d-m-Y', strtotime($rlt['gratify_user_birth_date']));
						move_uploaded_file($_FILES["gratify_profile"]["tmp_name"], "./../admin/upload/" . $profile);
						$result = ['success' => true, "msg" => "Update Success data.", "data" => $rlt];
						$this->response($this->json($result), 200);
					}
					$result = ['success' => true, "msg" => "Update Success"];
					$this->response($this->json($result), 200);
				}
				$error = ['success' => false, "msg" => $this->db->error];
				$this->response($this->json($error), 400);
			}
			$error = ['success' => false, "msg" => "Provide Firstname And Lastname"];
			$this->response($this->json($error), 400);
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);
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
		if ($this->checktoken()['success'] == true) {
			$this->version();
			if (!empty($_GET['gratify_user_id'])) {
				$gratify_user_id = $_GET['gratify_user_id'];
				$res = $this->db->query("SELECT * FROM user WHERE gratify_user_id='{$gratify_user_id}'");
				if (mysqli_num_rows($res) > 0) {
					while ($rlt = $res->fetch_assoc()) {
						$rlt['event_date'] = date('d-m-Y', strtotime($rlt['event_date']));
						$rlt1[] = $rlt;
					}
					$result = ['success' => true, "msg" => "Listing Successfull to fetch " . mysqli_num_rows($res) . " data.", "data" => $rlt1];
					$this->response($this->json($result), 200);
				}
				$result = ['success' => false, "msg" => "No Content"];
				$this->response($this->json($result), 200);	// If no records "No Content" status
			}
			$result = ['success' => false, "msg" => "Please provide Email ID"];
			$this->response($this->json($result), 200);	// If no records "No Content" status	
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);
	}

	private function adduser() // 5. New Patient 3.1.1
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}
		if ($this->checktoken()['success'] == true) {
			$this->version();
			$user_first_name = $this->_request['user_first_name'];
			$gratify_user_id = $this->_request['gratify_user_id'];
			$user_last_name = $this->_request['user_last_name'];
			$event_type = $this->_request['event_type'];
			$birthdate = $this->_request['event_date'];
			$birth_date = DATE('Y-m-d', strtotime($birthdate));
			if (!empty($this->_request['email_id'])) {
				$email_id = $this->_request['email_id'];
				if (filter_var($email_id, FILTER_VALIDATE_EMAIL)) {
					$res = $this->db->query("SELECT * FROM user WHERE email_id='{$email_id}'");
					if ($res->num_rows > 0) {
						$result = ['success' => false, "msg" => "Duplicate Record"];
						$this->response($this->json($result), 300);
					}
				} else {
					$error = array('status' => "Failed", "msg" => "Invalid Email address");
					$this->response($this->json($error), 400);
				}
			} else {
				$email_id = '';
			}
			if (!empty($this->_request['mobile_no'])) {
				$str = strlen($this->_request['mobile_no']);
				if ($str > 9  and $str <= 13) {
					$mobile_no = $this->_request['mobile_no'];
				} else {
					$result = ['success' => false,  'msg' => "Please Provide Valid Mobile Number"];
					$this->response($this->json($result), 200);
					$mobile_no = $this->_request['mobile_no'];
				}
			} else {
				$mobile_no = '';
			}
			$sql = $this->db->query("INSERT INTO user SET gratify_user_id ='{$gratify_user_id}',event_type = '{$event_type}',user_first_name = '$user_first_name',user_last_name = '$user_last_name',email_id = '{$email_id}',mobile_number = '{$mobile_no}',event_date   = '$birth_date',entry_date =NOW(),status=1");
			$result = ['success' => true, "msg" => "Saved", "id" => mysqli_insert_id($this->db)];
			$this->response($this->json($result), 200);
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);
	}
	private function synccalender() // 5.1 . New Patient 3.1.1
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}
		if ($this->checktoken()['success'] == true) {

			$this->version();
			$data = json_decode(file_get_contents("php://input"), true);
			$sql = "";

			foreach ($data as $k => $kv) {
				foreach ($kv as $k => $v) {
					$user_first_name = $v['user_first_name'];
					$gratify_user_id = $v['gratify_user_id'];
					$user_last_name = $v['user_last_name'];
					$event_type = $v['event_type'];
					$birthdate = $v['event_date'];
					$email_id = null;
					$mobile_no = 0;
					$birth_date = DATE('Y-m-d', strtotime($birthdate));
					$sql = "INSERT INTO user SET gratify_user_id ='{$gratify_user_id}',event_type = '{$event_type}',user_first_name = '$user_first_name',user_last_name = '$user_last_name', mobile_number='$mobile_no', email_id='', event_date = '$birth_date',entry_date =NOW(),status=1;";
					$res = $this->db->query($sql);
					$k++;
				}
			};
			sleep(3);
			$result = ['success' => true, "msg" => $k . " Saved"];
			$this->response($this->json($result), 200);
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);
	}

	private function updateuser() // 6. New Patient 3.1.1
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}
		if ($this->checktoken()['success'] == true) {

			$this->version();
			$user_id = $this->_request['user_id'];
			$user_first_name = $this->_request['user_first_name'];
			$user_last_name = $this->_request['user_last_name'];
			$birthdate = $this->_request['event_date'];
			$event_type = $this->_request['event_type'];
			$event_date = DATE('Y-m-d', strtotime($birthdate));
			if (!empty($this->_request['email_id'])) {
				if (filter_var($this->_request['email_id'], FILTER_VALIDATE_EMAIL)) {
					$email_id = $this->_request['email_id'];
				} else {
					$error = array('status' => "Failed", "msg" => "Invalid Email address");
					$this->response($this->json($error), 400);
				}
			} else {
				$email_id = '';
			}
			if (!empty($this->_request['mobile_no'])) {
				$str = strlen($this->_request['mobile_no']);
				if (9 < $str && $str <= 13) {
					$mobile_no = $this->_request['mobile_no'];
				} else {
					$result = ['success' => false,  'msg' => "Please Provide Valid mobile number"];
					$this->response($this->json($result), 200);
				}
			} else {
				$mobile_no = '';
			}
			$sql = $this->db->query("UPDATE user SET user_first_name = '$user_first_name',user_last_name = '$user_last_name',mobile_number = '$mobile_no',email_id = '{$email_id}',event_type = '$event_type',event_date = '$event_date',modify_date =NOW() WHERE user_id='{$user_id}'");


			$result = ['success' => true, "msg" => "Updated"];
			$this->response($this->json($result), 200);
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);
	}

	// ********************************************* //
	// ***********  For Deleteing Users  *********** //
	// ********************************************* //

	private function deleteUser() // 7. Delete the user
	{
		// Cross validation if the request method is DELETE else it will return "Not Acceptable" status
		if ($this->get_request_method() != "DELETE") {
			$this->response('', 406);
		}
		if ($this->checktoken()['success'] == true) {

			$this->version();
			$id = (int)$this->_request['id'];
			if ($id > 0) {
				$res = $this->db->query("SELECT * FROM user WHERE user_id = $id");
				if (mysqli_num_rows($res) > 0) {
					$this->db->query("DELETE FROM user WHERE user_id = $id");
					$success = array('success' => true, "msg" => "Successfully one record deleted.");
					$this->response($this->json($success), 200);
				}
				$success = array('success' => false, "msg" => "Record Not Found");
				$this->response($this->json($success), 200);
			}
			$success = array('success' => false, "msg" => "Please Enter Correct ID");
			$this->response($this->json($success), 200);
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);
	}
	private function delete() // 7. Delete the user - Only for Dev
	{
		$this->db->query("TRUNCATE user");
		$success = array('success' => true, "msg" => "Successfully deleted.");
		$this->response($this->json($success), 200);
	}
	private function gratify_user() // 8. Get all Gratify_Users
	{
		if ($this->get_request_method() != "GET") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to GET"];
			$this->response($this->json($result), 406);
		}

		if (!empty($_GET['gratify_user_id'])) {
			$gratify_user_id = $_GET['gratify_user_id'];
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
	private function logout() // 8. Get all Gratify_Users
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}
		if ($this->checktoken()['success'] == true) {
			$this->version();

			if (!empty($this->_request['gratify_user_id'])) {
				$gratify_user_id = $this->_request['gratify_user_id'];
				$res = $this->db->query("SELECT * FROM gratify_user WHERE gratify_user_id={$gratify_user_id}");

				if (mysqli_num_rows($res) > 0) {
					$res = $this->db->query("UPDATE gratify_user SET token = null WHERE gratify_user_id={$gratify_user_id} AND token = '{$this->checktoken()['token']}'");

					$result = ['success' => true, "msg" => "See You Again..."];
					$this->response($this->json($result), 200);
				}
				$result = ['success' => false, "msg" => "Not Found"];
				$this->response($this->json($result), 200);	// If no records "No Content" status
			}
			$result = ['success' => false, "msg" => "Please provide Gratify User Id"];
			$this->response($this->json($result), 200);
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);
	}
	private function forget_password() // 8. Get all Gratify_Users
	{
		if ($this->get_request_method() != "POST") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to POST"];
			$this->response($this->json($result), 406);
		}

		if (!empty($this->_request['gratify_user_email'])) {
			$gratify_user_email = $this->_request['gratify_user_email'];
			$res = $this->db->query("SELECT * FROM gratify_user WHERE gratify_user_email='{$gratify_user_email}'");

			if (mysqli_num_rows($res) > 0) {
				while ($rlt = $res->fetch_assoc()) {
					$gratify_user_fname = $rlt['gratify_user_fname'];
					$gratify_user_lname = $rlt['gratify_user_lname'];
					$user = $gratify_user_fname . ' ' . $gratify_user_lname;
					$gratify_user_mail = $rlt['gratify_user_email'];
				}
				if ($gratify_user_email == null) {
					echo json_encode(['success' => false, "msg" => "Please Provide Email"]);
				} else {
					$mail = $gratify_user_email;
					require_once(__DIR__ . '/vendor/autoload.php');
					$config = SendinBlue\Client\Configuration::getDefaultConfiguration()->setApiKey('api-key', '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');
					$apiInstance = new SendinBlue\Client\Api\TransactionalEmailsApi(
						new GuzzleHttp\Client(),
						$config
					);
					$sendSmtpEmail = new \SendinBlue\Client\Model\SendSmtpEmail();
					$sendSmtpEmail['subject'] = 'Please Reset Your Password From Here';
					$sendSmtpEmail['htmlContent'] = '<!DOCTYPE html>
							<html lang="en">
							
							<head>
								<meta charset="UTF-8">
								<meta http-equiv="X-UA-Compatible" content="IE=edge">
								<meta name="theme-color" content="#ff7812">
								<meta name="viewport" content="width=device-width, initial-scale=1.0">
								<link rel="icon" href="upload/favicon.png">
								<link rel="preconnect" href="https://fonts.googleapis.com">
								<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
								<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@100;200;300;400;500;600;700;800;900&display=swap">
								<title>Gratify | Please Enter Email Address</title>
							</head>
							
							
							<body>
								<div class="modal-dialog modal-dialog-centered"
									style="font-family: Poppins;max-width: 500px; min-height: calc(100% - 1rem); position: relative; width: auto; margin: 0.5rem; pointer-events: none;">
									<div class="modal-content"
										style="position: relative; width: 100%; pointer-events: auto; background-color: #fff; background-clip: padding-box; border: 1px solid #0003; border-radius: 0.3rem; outline: 0;">
										<div
											style="text-align: center; padding: 1rem 1rem;">
											<img src="https://gratify.uptechies.com/img/logo.png" width="100px" height="100px" alt="Gratify Logo">
										</div>
										<div class="modal-body" style="position: relative; flex: 1 1 auto; padding: 1rem;">
											<div class="title mb-10" style="margin-bottom: 10px;">Hello ,<b> ' . $user . '</b></div>
											<div class="h6 mb-50" style="font-size: 1rem; margin: 0 0 40px; font-weight: 500; line-height: 1.2;">
												We got a request to reset your Gratify password.
											</div>

											<div style="text-align: center;">
												<a href="http://192.168.0.112:8080/website/gratifyv2/admin/forget_pass.php?email=' . $gratify_user_mail . '"
													style="color: #0d6efd; text-decoration: underline;">
													<button
														style="width:100%;-webkit-appearance: button; margin: 0; text-transform: none; display: inline-block; line-height: 1.5; text-align: center; text-decoration: none; vertical-align: middle; cursor: pointer; -webkit-user-select: none; -moz-user-select: none; user-select: none; background-color: #0000; border: 1px solid #0000; padding: 0.375rem 0.75rem; color: #fff; background: linear-gradient(90deg, #FF6601 0%, #FF003C 100%); box-shadow: 0px 10px 20px rgba(255, 73, 17, 0.2); border-radius: 8px;  font-weight: 500; font-size: 22px;">Reset
														your password</button></a>
											</div>
											<p style="padding:0;margin:10px 0 10px 0;color:#565a5c;font-size:12px">If you ignore this message, your
												password will not be changed. If you didn\'t request a password reset,let us know.</p>
										</div>
									</div>
								</div>

								<script src="js/sb-admin-2.min.js"></script>
								<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
							</body>
							
							</html>';
					// $sendSmtpEmail['htmlContent'] = $link;
					$sendSmtpEmail['sender'] = array('name' => 'Gratify', 'email' => 'uptechies@gmail.com');
					$sendSmtpEmail['to'] = array(
						array('email' => $mail, 'name' => $gratify_user_fname . ' ' . $gratify_user_lname)
					);
					$sendSmtpEmail['replyTo'] = array('email' => 'uptechies@gmail.com', 'name' => 'Uptechies');
					$sendSmtpEmail['headers'] = array('Some-Custom-Name' => 'unique-id-1234');
					// $sendSmtpEmail['params'] = array('parameter' => 'My param value', 'subject' => 'New Subject');

					try {
						$mailsend = $apiInstance->sendTransacEmail($sendSmtpEmail);
						$result = ["success" => true, "msg" => "Please check your mailbox we just sent password reset link to " . $gratify_user_email];
					} catch (Exception $e) {
						$result = ["success" => false, "msg" => 'Exception when calling TransactionalEmailsApi->sendTransacEmail: ', $e->getMessage(), PHP_EOL];
					}
				}
				$this->response($this->json($result), 200);
			}
			$result = ['success' => false, "msg" => "This email doesn't exist"];
			$this->response($this->json($result), 200);	// If no records "No Content" status
		}
		$result = ['success' => false, "msg" => "Please Correct provide Gratify User Id"];
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
		if ($this->checktoken()['success'] == true) {

			$this->version();
			if (!empty($_GET['category_id'])) {
				$category_id = $_GET['category_id'];
				$res = $this->db->query("SELECT * FROM card WHERE cat_id={$category_id}");
				if (mysqli_num_rows($res) > 0) {
					while ($card = $res->fetch_assoc()) {
						if ($card['isActive'] == 1) {
							$card['isActive'] = true;
						} else {
							$card['isActive'] = false;
						}
						$ratio = getratio();

						foreach ($ratio as $ratio_key => $ratio_value) {
							if ($ratio_value['ratio_id'] == $card['ratio_id']) {
								$card['ratio_id'] = $ratio_value['aspect_ratio'];
							}
						}
						$id = $card['card_id'];
						$ap1 = $this->db->query("SELECT * FROM text WHERE card_id=$id");
						$temp_array = array();
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
			$result = ['success' => false, "msg" => "Please provide category_id"];
			$this->response($this->json($result), 200);
		}
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);	// If no records "No Content" status
	}
	private function category() // 8. Get all Gratify_Users
	{
		if ($this->get_request_method() != "GET") {
			$result = ['success' => false, 'method' => $this->get_request_method(), 'error' => "Change Method to GET"];
			$this->response($this->json($result), 406);
		}
		if ($this->checktoken()['success'] == true) {

			$this->version();
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
		$result = ['success' => false,  'msg' => "Unauthorization"];
		$this->response($this->json($result), 401);	// If no records "No Content" status
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