def cico_retries = 16
def cico_retry_interval = 60
def ci_git_repo = 'https://github.com/nixpanic/noobaa-core'
def ci_git_branch = 'ci/centos'
def repo = 'https://github.com/noobaa/noobaa-core'
def ref = "master"

// temporary variables, see .travis.yml
def TRAVIS_COMMIT = "01234abcde"
def IMAGE_TAG = "noobaa-${TRAVIS_COMMIT}"
def TESTER_TAG = "noobaa-tester-${TRAVIS_COMMIT}"
def NO_CACHE = "NO_CACHE=true"
def SUPPRESS_LOGS = "SUPPRESS_LOGS=true"
def DEPLOY_MINIKUBE_REDIRECT = "/dev/null"

node('cico-workspace') {
	stage('checkout ci repository') {
		git url: "${ci_git_repo}",
			branch: "${ci_git_branch}",
			changelog: false
	}

	stage('reserve bare-metal machine') {
		def firstAttempt = true
		retry(30) {
			if (!firstAttempt) {
				sleep(time: 5, unit: "MINUTES")
			}
			firstAttempt = false
			cico = sh(
				script: "cico node get -f value -c hostname -c comment --release=8 --retry-count=${cico_retries} --retry-interval=${cico_retry_interval}",
				returnStdout: true
			).trim().tokenize(' ')
			env.CICO_NODE = "${cico[0]}.ci.centos.org"
			env.CICO_SSID = "${cico[1]}"
		}
	}

	try {
		stage('prepare bare-metal machine') {
			if (params.ghprbPullId != null) {
				ref = "pull/${ghprbPullId}/head"
			}
			sh 'scp -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no ./prepare.sh root@${CICO_NODE}:'
			sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@${CICO_NODE} ./prepare.sh --workdir=/opt/build/noobaa-core --gitrepo=${repo} --ref=${ref}"
		}

		// real tests start here, and they run in parallel
		parallel unit: {
			stage ('Unit Tests') {
				node ('cico-workspace') {
					sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@${CICO_NODE} 'cd /opt/build/noobaa-core && make tester ${NO_CACHE} ${SUPPRESS_LOGS}'"
					sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@${CICO_NODE} 'cd /opt/build/noobaa-core && make test ${SUPPRESS_LOGS}'"
				}
			}
		},
		build: {
			stage ('Build & Sanity Integration Tests') {
				node ('cico-workspace') {
					sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@${CICO_NODE} 'cd /opt/build/noobaa-core && ./.travis/deploy_minikube.sh 1 >& ${DEPLOY_MINIKUBE_REDIRECT}'"
					sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@${CICO_NODE} 'cd /opt/build/noobaa-core && make tester NOOBAA_TAG=${IMAGE_TAG} TESTER_TAG=${TESTER_TAG} ${NO_CACHE} ${SUPPRESS_LOGS}'"
					sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@${CICO_NODE} 'cd /opt/build/noobaa-core && cd ./src/test/framework/ && ./run_test_job.sh --name ${TRAVIS_COMMIT} --image ${IMAGE_TAG} --tester_image ${TESTER_TAG} --job_yaml ../../../.travis/travis_test_job.yaml --wait'"
				}
			}
		}
	}

	catch (exc) {
		stage('time to debug') {
			sh 'sleep 2h'
		}
	}

	finally {
		stage('return bare-metal machine') {
			sh 'cico node done ${CICO_SSID}'
		}
	}
}
