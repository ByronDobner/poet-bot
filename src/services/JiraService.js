const axios = require('axios');

const jiraDetails = {
	name: process.env.JIRA_NAME,
	password: process.env.JIRA_PASSWORD,
	url: process.env.JIRA_URL,
	issue_endpoint: process.env.JIRA_ISSUE_ENDPOINT,
	search_endpoint: process.env.JIRA_SEARCH_ENDPOINT
};

// search the JIRA API using an issueID and return the response or throw and error
module.exports.issueInfo = (issueID) => {
    console.log('JIRA URL: ' + jiraDetails.url + jiraDetails.issue_endpoint + issueID);
    return axios.get(jiraDetails.url + jiraDetails.issue_endpoint + issueID, {
        auth: {
            username: jiraDetails.name,
            password: jiraDetails.password
        }
    })
    .then(response => {
        return response.data;
    })
    .catch(error => {
        console.log("Jira Error: " + error.response.data['errorMessages']);
        throw new Error(error.response.data['errorMessages'] || error.response.data['warningMessages']);
    });
};

// search the JIRA API using a JQL statement and return the response or throw and error
module.exports.assigneeInfo = (jql) => {
    console.log('JIRA URL: ' + jiraDetails.url + jiraDetails.search_endpoint + jql);
    return axios.get(jiraDetails.url + jiraDetails.search_endpoint , {
        params: {
            jql: jql
        },
        auth: {
            username: jiraDetails.name,
            password: jiraDetails.password
        }
    })
    .then(response => {
        return response.data;
    })
    .catch(error => {
        console.log("Jira Error: " + error.response.data['errorMessages']);
        throw new Error(error.response.data['errorMessages'] || error.response.data['warningMessages']);
    });
};

// Given a JIRA issueID as input, return it as a Slack hyperlink
module.exports.HyperlinkJiraIssueID = (issueID) => {
    return `<${process.env.JIRA_URL}/browse/${issueID}|${issueID.toUpperCase()}>`
};