// AWS auth params for every /api/aws call: a local CLI profile or pasted keys
export function awsAuth(data) {
  return data.awsProfile
    ? { awsProfile: data.awsProfile, region: data.region }
    : { accessKeyId: data.accessKeyId, secretAccessKey: data.secretAccessKey, sessionToken: data.sessionToken, region: data.region }
}
