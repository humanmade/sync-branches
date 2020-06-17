const core = require("@actions/core");
const github = require("@actions/github");
const context = github.context;

async function run() {
  try {
    const fromBranch = core.getInput("FROM_BRANCH", { required: true });
    const toBranch = core.getInput("TO_BRANCH", { required: true });
    const githubToken = core.getInput("GITHUB_TOKEN", { required: true });
    const requiredLabel = core.getInput("REQUIRED_LABEL", { required: true });
    const pullRequestTitle = core.getInput("PULL_REQUEST_TITLE");
    const pullRequestBody = core.getInput("PULL_REQUEST_BODY");
    const pullRequestIsDraft = core.getInput("PULL_REQUEST_IS_DRAFT").toLowerCase() === "true";

    // Check if required label exists for the PR.
    const labels = context.payload.pull_request.labels;
    const existingLabels = labels.filter(label => label.name == requiredLabel);

    if ( existingLabels.length === 0 ) {
      console.log( `PR does not have label '${requiredLabel}', Not assigning a reviewer.` );
      core.ExitCode = 0;

      return;
    }

    const {
      payload: { repository }
    } = github.context;

    const octokit = new github.GitHub(githubToken);

    const { data: currentPulls } = await octokit.pulls.list({
      owner: repository.owner.login,
      repo: repository.name
    });

    // Remove the label from PR.
    await octokit.issues.removeLabel({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: context.payload.pull_request.number,
      name: requiredLabel
    });

    const newBranch = `${fromBranch}-dev`;

    // throws HttpError if branch already exists.
    try {
      const branch = await octokit.repos.getBranch({
        owner: repository.owner.login,
        repo: repository.name,
        branch: newBranch
      });

      if ( branch.status === 200 ) {
        throw Error(`Branch ${newBranch} already exists, Please delete and restart the workflow.`);
      }
    } catch(error) {
      console.log(github);
      if(error.name === 'HttpError' && error.status === 404) {
        await octokit.git.createRef({
          owner: repository.owner.login,
          repo: repository.name,
          ref: `refs/heads/${newBranch}`,
          sha: github.context.sha
        })
      } else {
        throw Error(error)
      }
    }

    console.log(`Making a pull request to ${newBranch} from ${fromBranch}.`);

    const currentPull = currentPulls.find(pull => {
      return pull.head.ref === fromBranch && pull.base.ref === newBranch;
    });

    if (!currentPull) {
      const { data: pullRequest } = await octokit.pulls.create({
        owner: repository.owner.login,
        repo: repository.name,
        head: newBranch,
        base: toBranch,
        title: pullRequestTitle
          ? pullRequestTitle
          : `sync: ${fromBranch} to ${toBranch}`,
        body: pullRequestBody
          ? pullRequestBody
          : `sync-branches: Merge #${context.payload.pull_request.number} to ${toBranch}`,
        draft: pullRequestIsDraft
      });

      console.log(
        `Pull request (${pullRequest.number}) successful! You can view it here: ${pullRequest.url}.`
      );

      core.setOutput("PULL_REQUEST_URL", pullRequest.url.toString());
      core.setOutput("PULL_REQUEST_NUMBER", pullRequest.number.toString());
    } else {
      console.log(
        `There is already a pull request (${currentPull.number}) to ${toBranch} from ${fromBranch}.`,
        `You can view it here: ${currentPull.url}`
      );

      core.setOutput("PULL_REQUEST_URL", currentPull.url.toString());
      core.setOutput("PULL_REQUEST_NUMBER", currentPull.number.toString());
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
