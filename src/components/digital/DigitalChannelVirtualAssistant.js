import {
	Card,
	Box,
	Badge,
	SkeletonLoader,
	Tab,
	Tabs,
	Separator,
	Stack,
	TabPanel,
	TabPanels,
	TabList,
	Heading,
	Grid,
	Column,
	Paragraph,
	AlertDialog
} from "@twilio-paste/core";

import DigitalChannelNextBestAction from "./DigitalChannelNextBestAction";
// import ConversationSummaryCard from "./ConversationSummaryCard";

import { useEffect, useState } from "react";
import { withTaskContext } from "@twilio/flex-ui";

import { Manager } from "@twilio/flex-ui";
import { Actions } from "@twilio/flex-ui";
import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
	apiKey: process.env.REACT_APP_OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  
const manager = Manager.getInstance();

const GPT_MODEL="gpt-3.5-turbo"; //"gpt-4-0314", text-davinci-003"

const defaultCustomerProfileSummary = `
Loyalty: 3 years
LTV: $529.71

Recent Activity:

Viewed "Dri-Fit Run" product twice on 2023-05-13

Please note the customer's loyalty and recent interest in the "Dri-Fit Run" product while assisting them.`

const DigitalChannelVirtualAssistant = (props) => {
	const [isLoading, setIsLoading] = useState(false);
	const [nextBestActionTranscript, setNextBestActionTranscript] = useState(null);
	const [vaSummary, setVASummary] = useState("Not available");
	const [isLoadingVASummary, setIsLoadingVASummary] = useState(false);
	const [sentiment, setSentiment] = useState("neutral");
	const [sentimentBadgeValue, setSentimentBadgeValue] = useState('success');
	const [intent, setIntent] = useState('Not available');
	const [isSegmentAlertOpen, setIsSegmentAlertOpen] = useState(false);
	const [isCompletingTask, setIsCompletingTask] = useState(false);
	const [finalSummary, setFinalSummary] = useState("");
	const [nextBestAction, setNextBestAction] = useState("Not available");

	const [profileSummary, setProfileSummary] = useState(defaultCustomerProfileSummary);
	const [isFetchingProfileSummary, setIsFectchingProfileSummary] = useState(false);

	const handleSegmentAlertOpen = () => setIsSegmentAlertOpen(true);
	const handleSegmentAlertClose = (payload, original) => {
		console.log(`DigitalChannelVirtualAssistant: handleSegmentAlertClose: `);
		setIsSegmentAlertOpen(false);
	}

	const handleSegmentAlertAccept = async (payload, original) => {
		console.log(`DigitalChannelVirtualAssistant: handleSegmentAlertAccept: completing task now`);
		setIsSegmentAlertOpen(false);
		await pushNewDataToSegment();
		Actions.invokeAction("CompleteTask", { sid: props.task.sid });
	}

	const updateSegment = async (payload) => {
		try {
			const token = `${process.env.REACT_APP_SEGMENT_WRITE_TOKEN}:`;
			const authorization = `Basic ${Buffer.from(token).toString("base64")}`;

			const response = await fetch(
				process.env.REACT_APP_SEGMENT_WRITE_ENDPOINT,
				{
					method: "POST",
					headers: {
						Authorization: authorization,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				}
			);

			if (!response.ok) {
				throw new Error("Segment update failed");
			}

			return response.json();
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	async function pushNewDataToSegment() {

		const payloadSegment = {
			anonymousId: "flexSummary_" + props.task.attributes.emailAddress,
			event: "Transcript Summarization from Flex",
			properties: {
				email: props.task.attributes.emailAddress,
				summary: finalSummary.replace(/^\n+/, ''),
				sentiment: sentiment,
				intent: intent
			},
			type: "track",
		};

		try {
			const response = await updateSegment(payloadSegment);
			console.log(response);
			console.log("Segment update successful");
		} catch (error) {
			console.error(error);
			console.log("Segment update failed");
		} finally {
			handleSegmentAlertClose();
		}
	}

		const submitDataToSegment = async () => {
			return pushNewDataToSegment();

			// TODO
			console.log(`DigitalChannelVirtualAssistant: TODO pushSummaryToSegment: ${finalSummary}, ${sentiment}, ${intent}`);
			try {
				const response = await fetch(
					process.env.REACT_APP_UPDATE_PROFILE_ENDPOINT,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(
							{"summary": `${finalSummary}`,
							 "email": `${props.task.attributes.emailAddress}`,
							 "sentiment": `${sentiment}`,
							 "intent": `${intent}`,
							"instanceIdentifier": "GO4d208fdeb4cd4885beb7b2bea797c37c"
						}),
					}
				);
		
				if (!response.ok) {
					console.error(`Failed to update profile : ${response.status}`)
					return;
				}
		
				const data = await response.json();
			} catch (error) { 
			  console.error('Error updating profile summary:', error);
			}
			submitDataToSegment();
		};
		


	// Fetches conversations messages
	// TODO we have a workaround that sets the intent from the first message because the intent we get from DF is hand over to agent.
	// We should replace this logic
	async function fetchMessages() {
		try {
			const conversationsClient = manager.conversationsClient;
			const conversation = await conversationsClient.getConversationBySid(
				props.task.attributes.conversationSid
			);
			const messages = await conversation.getMessages();
			if (messages.items.length > 0) {
				setIntent(messages.items[0].body);
			}
			return messages.items;
		} catch (err) {
			console.error("Error fetching messages:", err);
			throw err;
		}
	}

	// Fetches the messages and converts the response into an array of JSON messages
	async function retrieveTranscriptFromConversationHistory() {
		try {
			const messages = await fetchMessages();
			const messageJsonArrays = constructMessageJsonArrays(messages);
			return messageJsonArrays;
		} catch (err) {
			console.error(
				"Error retrieving transcript from conversation history:",
				err
			);
			throw err;
		}
	}

	async function retrieveTranscript() {
		const conversationsTranscript =
			await retrieveTranscriptFromConversationHistory();

		let nbaTranscript = "";
		for (const item of conversationsTranscript[0]) {
			const { customerIntent, virtualAgentReply, customerName, author } =
				item;
			nbaTranscript += `${customerName}: ${customerIntent}\n${author}: ${virtualAgentReply}\n`;
		}

		if (conversationsTranscript[1].length > 0) {
			for (const item of conversationsTranscript[1]) {
				const { author, body, customerName } = item;
				if (author === "") {
					nbaTranscript += `${customerName}: ${body}\n`;
				} else {
					nbaTranscript += `${author}: ${body}\n`;
				}
			}
		}

		return nbaTranscript;
	}

	function constructMessageJsonArrays(messages) {
		try {
			const messageJsonArray = [];
			const messageJsonArrayAfterHandoff = [];
			let foundHandoff = false;
			//We will use a uuidRegex to check for a WebChat identity as the author of the message in the logic below
			const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
			for (let i = 0; i < messages.length; i++) {
				const message = messages[i];
				console.log(`constructMessageJsonArrays: ${message}`);
				if (!foundHandoff) {
					//The messages we care about for generating (before live agent handoff) the transcript are only the messages sent by the VirtualAgent, this is because those messages have the critical data we need to display, including the customer's message that prompted it's reply, allow us to reconstruct the full transcript of the Virtual Agent Conversation
					if (message.author !== "Fred 🤖") {
						continue;
					}
					const sentimentAnalysisResult =
						message.attributes.sentimentAnalysisResult || null;
					const messageJson = {
						author: message.author,
						dateCreated: message.dateCreated,
						dateUpdated: message.dateUpdated,
						conversationSid: props.task.attributes.conversationSid,
						messageSid: message.sid,
						virtualAgentReply: message.attributes.virtualAgentReply,
						customerIntent: message.attributes.customerIntent,
						confidence: message.attributes.match.confidence,
						sentimentAnalysisResult,
						sessionID: message.attributes.sessionID,
						intentDisplayName: message.attributes.match.intent
							? message.attributes.match.intent.displayName
							: message.attributes.match.matchType,
						customerName: props.task.attributes.customerName,
					};
					messageJsonArray.push(messageJson);
				} else {
					const messageAfterHandoffJson = {
						//Set the author to blank if its a phone number (SMS/Whatsapp customer) or a UUID (webchat customer). If it's not either, we assume it to be the Flex worker, which will help us later in the construction of pTranscript and nbaTranscript, since for the customer we will use "customerName", not author, in building the transcript
						author: message.author.startsWith("+") || uuidRegex.test(message.author)
						  ? ""
						  : props.task._task._worker.attributes.full_name,
						body: message.body,
						customerName: props.task.attributes.customerName,
					  };
					messageJsonArrayAfterHandoff.push(messageAfterHandoffJson);
				}
				if (message.attributes.liveAgentHandoff) {
					foundHandoff = true;
				}
			}
			return [messageJsonArray, messageJsonArrayAfterHandoff];
		} catch (err) {
			console.error("DigitalChannelVirtualAgent: constructMessageJsonArrays: Error constructing message JSON arrays:", err);
			throw err;
		}
	}

	// Helper method that retries chat completion with a back off if it encounters a 429
	async function createChatCompletionWithRetry(chatCompletionObj,
		retries = process.env.REACT_APP_MAX_RETRIES,
		backoff = process.env.REACT_APP_RETRY_DELAY_MS) {

		try {
			const response = await openai.createChatCompletion(chatCompletionObj);
		
			if (response.status === 429 && retries > 0) {
				console.error(`createChatCompletionWithRetry: got a 429. retry=${retries}`)
				return new Promise((resolve, reject) => {
				setTimeout(() => {
					createChatCompletionWithRetry(chatCompletionObj, retries - 1, backoff * 2)
					.then(resolve)
					.catch(reject);
				}, backoff);
			  });
			}
		
			return response;
		  } catch (error) {
			console.error(`createChatCompletionWithRetry: got ${error}. retry=${retries}`)
			if (retries <= 0 || !error.response || error.response.status !== 429) {
			  throw error;
			}
		
			return new Promise((resolve, reject) => {
			  setTimeout(() => {
				createChatCompletionWithRetry(chatCompletionObj, retries - 1, backoff * 2)
				.then(resolve)
				.catch(reject);
			  }, backoff);
			});
		  }
	}

	async function createSummary() {
		const updatedTranscript = await retrieveTranscript();
		console.log(`createSummary: Summarizing: ${updatedTranscript}`)
		if ( updatedTranscript.length == 0) {
			return;
		}

		const completion = await createOpenAISummary(updatedTranscript);
		setTimeout(() => { // Adding a little timeout to avoid 429 from openai
			// TODO remove from here
			findInferredTraits(updatedTranscript);
		}, 1000);

		return completion.data.choices[0].message?.content
	};

	// Get OpenAI to summarize the transcript
	const createOpenAISummary = async (transcript) => {
		const prompt = `In 5 sentences or less, provide a summarization of the following transcript: ${transcript}`;

		const completion = await /*openai.createChatCompletion*/
		createChatCompletionWithRetry({
			model: GPT_MODEL,
			messages: [
			  {"role": "system", "content": prompt},
			  {"role": "user", "content": transcript},
			],
			temperature: 0.6,
			n: 1,
			max_tokens: 1000
		});

		return completion;
	};

	// Get OpenAI to summarize the transcript
	const findInferredTraits = async (transcript) => {
		const prompt = `Find maximum 3 inferred traits in this conversation between customer and contact center agent and Fred the bot. 
		Find traits that are applicable to upsell and things the customer likes.
		Only infer traits from the customer ${props.customerName}. Return the results in JSON array.
		if there are no inferred traits, return and empty JSON array. ${transcript}`;

		try {
			const completion = await /*openai.createChatCompletion*/
			createChatCompletionWithRetry({
				model: GPT_MODEL,
				messages: [
				  {"role": "system", "content": prompt},
				  {"role": "user", "content": transcript},
				],
				temperature: 0.6,
				n: 1
			});
			
			console.log(`findInferredTraits: ${completion.data.choices[0].message?.content}`);
	
		} catch(error) {
			console.error(`findInferredTraits: Failed to download: ${error}`)
		}
	};

	function updateCustomerSentimentAndNextBestAction(message) {
		if (props?.task?.attributes.conversationSid == null) {
			return;
		}

		const { author, body, attributes } = message;
		console.log(`DigitalChannelVirtualAssistant: updateCustomerSentimentAndNextBestAction: message:${message}, author:${author}, body:${body}, attributes:${attributes}`);

		if (attributes) {
			const uuidRegex =
			/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
			if (author.startsWith("+") || uuidRegex.test(author)) {
				if ( attributes.sentiment ) {
					setSentiment(attributes.sentiment);
				}

				if (attributes.nextBestAction) {
					setNextBestAction(attributes.nextBestAction);
				}
			} else {
				console.log("DigitalChannelVirtualAssistant: updateCustomerSentimentAndNextBestAction: No author match");
			}

		} else {
			console.log("DigitalChannelVirtualAssistant: updateCustomerSentimentAndNextBestAction: Didnt get attributes");
		}
	};		

	// Profile Summary
	useEffect(() => {
		const fetchProfileSummary = async () => {
		  console.log(`DigitalChannelVirtualAssistant: Fetching profile summary for ${props.task.attributes.emailAddress}`);
		  try {
			const response = await fetch(
			  process.env.REACT_APP_PROFILE_SUMMARY_ENDPOINT,
			  {
				method: "POST",
				headers: {
				  "Content-Type": "application/json",
				},
				body: JSON.stringify({
				  "attributes": [{"key": "email", "value": `${props.task.attributes.emailAddress}`}],
				  "instanceIdentifier": "GO4d208fdeb4cd4885beb7b2bea797c37c"
				}),
			  }
			);
	  
			if (!response.ok) {
			  console.error(`Failed to fetch profile summary: ${response.status}`);
			  return;
			}
	  
			const data = await response.json();
		  } catch (error) {
			console.error('Error fetching profile summary:', error);
		  }
		};
	  
		fetchProfileSummary();
	}, [props?.task?.attributes.conversationSid]);

	// Wraup handling
	useEffect(() => {
		// Custom task complete action
		const customTaskWrapup = async (payload, original) => {
			console.log(`DigitalChannelVirtualAssistant: customTaskWrapup: ${payload}`);

			try {
				setIsSegmentAlertOpen(true);
				const newSummary = await createSummary();
				setFinalSummary(newSummary);
				setIsCompletingTask(true);
				console.log(`DigitalChannelVirtualAssistant: handleCompleted: got summary ${newSummary}`);
			} catch(error) {	
				console.error(`DigitalChannelVirtualAssistant: customTaskComplete: ${error}`);
				setIsSegmentAlertOpen(false);
			} finally {
				setIsCompletingTask(false);
			}

			// If you want to call the original CompleteTask action after your custom logic:
			return original(payload);
		};
		
		// Replace the default CompleteTask action with the custom action
		Actions.replaceAction('WrapupTask', customTaskWrapup);


		const handleWrapup = (task) => {
			console.log(`DigitalChannelVirtualAssistant: handleWrapup: ${task}`);
		};
	
		const handleCompleted = async (task) => {
			console.log(`DigitalChannelVirtualAssistant: handleCompleted: ${task}`);

		};

		manager.events.addListener("taskWrapup", handleWrapup);
		manager.events.addListener("taskCompleted", handleCompleted);

		return () => {
			manager.events.removeListener("taskWrapup", handleWrapup);
			manager.events.removeListener("taskCompleted", handleCompleted);
		};

	}, [props?.task?.attributes.conversationSid])

	// Update summary between agent and customer once
	useEffect(() => {
		if (props?.task?.attributes.conversationSid == null) {
			return;
		}

	}, [props?.task?.attributes.conversationSid]);

	// Update sentiment
	useEffect(() => {
		if (props?.task?.attributes.conversationSid == null) {
			return;
		}

		const conversationsClient = manager.conversationsClient;
		const handleNewMessage = async (message) => {
			console.log("DigitalChannelVirtualAssistant: Got new message: ", message);
			updateCustomerSentimentAndNextBestAction(message);
			return Promise.resolve();
		}

		const handleUpdatedMessage = async (data) => {
			console.log("DigitalChannelVirtualAssistant: Got update message: ", data);
			updateCustomerSentimentAndNextBestAction(data.message);
			return Promise.resolve();
		}
		
		conversationsClient.addListener("messageAdded", handleNewMessage);
		conversationsClient.addListener("messageUpdated", handleUpdatedMessage);

		return () => {
			conversationsClient.removeListener("messageAdded", handleNewMessage);
			conversationsClient.removeListener("messageUpdated", handleUpdatedMessage);
		};

	}, [props?.task?.attributes.conversationSid]);

	useEffect( () =>  {
		if (sentiment === 'positive') {
			setSentimentBadgeValue('success')
		} else if ( sentiment === 'neutral') {
			setSentimentBadgeValue('neutral')
		} else {
			setSentimentBadgeValue('warning');
		}
	}, [sentiment]);

	// Update Intent and VA summary once from conversation attributes
	useEffect(async () =>  {
		if (props?.task?.attributes.conversationSid == null) {
			return;
		}

		try {
			setIsLoadingVASummary(true);
			const newSummary = await createSummary();
			setVASummary(newSummary);

		} catch(error) {
			console.log("DigitalChannelVirtualAssistant: Summary useEffect error: ", error);
		} finally {
			setIsLoadingVASummary(false);
		}

		const handleConversationUpdated = async (data) => {
			console.log("DigitalChannelVirtualAssistant: handleConversationUpdated: ", data);
			const conversation = data.conversation;
			return Promise.resolve();
		}

		const conversationsClient = manager.conversationsClient;
		conversationsClient.addListener("conversationUpdated", handleConversationUpdated);

		return () => {
			conversationsClient.removeListener("conversationUpdated", handleConversationUpdated);
		};

	}, [props?.task?.attributes.conversationSid]);

	// Next best action
	useEffect(async () => {
		if (props?.task?.attributes.conversationSid == null) {
			return;
		}

		const handleNewMessage = async () => {
			try {
				setIsLoading(true);
				const nbaTranscript = await retrieveTranscript();
				setNextBestActionTranscript(nbaTranscript);	
			} catch(error) {
				console.error("Error retrieving transcript:", error);
			} finally {
				setIsLoading(false);
			}
	
			handleNewMessage();

			return Promise.resolve();
		}

		return () => {
			conversationsClient.removeListener("messageAdded", handleNewMessage);
		};

	}, [props?.task?.attributes.conversationSid]);

	return (
		<Card>
			<AlertDialog
				heading="Update Segment with Summary"
				isOpen={isSegmentAlertOpen}
				onConfirm={handleSegmentAlertAccept}
				onConfirmLabel="Update & Complete Task"
				onDismiss={handleSegmentAlertClose}
				onDismissLabel="Cancel">
				<Paragraph marginBottom='space0'>You are about to update the Segment Profile of{" "}
				{props.customerName} with the following summary:</Paragraph>
				<Card><Paragraph marginBottom='space0'>{finalSummary}</Paragraph></Card>
				<Paragraph marginBottom='space0'>Click "Update & Complete Task" to proceed, or "Cancel" to return to Flex.</Paragraph>
			</AlertDialog>
			<Tabs
				selectedId="CRM"
				baseId="openai">
				<TabList aria-label="OpenAI Tab">
					<Tab id="CRM">CRM</Tab>
					<Tab id="digitalChannelVirtualAssistant">Owlie</Tab>
				</TabList>
				<TabPanels>
					<TabPanel>
					<div>
						<iframe
							title="MyIframe"
							src="https://google.com"
							width="100%"
							height="500px"
							frameBorder="0"
						></iframe>
						</div>
					</TabPanel>
					<TabPanel>
						<Grid gutter="space30">
							<Column>
								<Card padding="space70">
									<Heading as="h4" variant="heading40">Sentiment</Heading>
									<Box display="flex" columnGap="space40" rowGap="space20" flexWrap="wrap">
										<Badge as="span" variant={sentimentBadgeValue}>{sentimentBadgeValue}</Badge>
									</Box>
								</Card>
							</Column>
							<Column>
								<Card padding="space70">
									<Heading as="h4" variant="heading40">Intent</Heading>
									<Box display="flex" columnGap="space40" rowGap="space20" flexWrap="wrap">
										<Badge as="span" variant="decorative10">{intent}</Badge>
									</Box>
								</Card>
							</Column>
						</Grid>
						{nextBestActionTranscript && (
							<DigitalChannelNextBestAction
								events={props.task.attributes.events}
								customerData={props.task.attributes.customers}
								conversationSid={props.task.attributes.conversationSid}
								customerName={props.task.attributes.customerName}
								nextBestActionTranscript={nextBestActionTranscript}
								workerName={props.task._task._worker.attributes.full_name}
								customerEmail={props.task.attributes.emailAddress}
							/>
						)}
						<Box backgroundColor="colorBackgroundBody" padding="space50">
							<Separator orientation="horizontal" verticalSpacing="space50" />
						</Box>
						<Stack orientation="horizontal" spacing="space50">
							<Heading as="h4" variant="heading30" marginBottom="space0">
								🤖 Summary
							</Heading>
						</Stack>
						{isLoadingVASummary ? (
						<>
						<Heading as="h4" variant="heading30"></Heading>
						<SkeletonLoader height="150px" />
						</>) : (
						<Card>
							<Paragraph marginBottom='space0'>{vaSummary}</Paragraph>
						</Card>)}

						<Box backgroundColor="colorBackgroundBody" padding="space50">
							<Separator orientation="horizontal" verticalSpacing="space50" />
						</Box>
						<Stack orientation="horizontal" spacing="space50">
							<Heading as="h4" variant="heading30" marginBottom="space0">
								Suggested response
							</Heading>
						</Stack>
						<Card>
							<Paragraph marginBottom='space0'>{nextBestAction}</Paragraph>
						</Card>
						
						{ false ? (<></>) : (<>
						<Box backgroundColor="colorBackgroundBody" padding="space50">
							<Separator orientation="horizontal" verticalSpacing="space50" />
						</Box>
						<Stack orientation="horizontal" spacing="space50">
							<Heading as="h4" variant="heading30" marginBottom="space0">
								Profile Summary
							</Heading>
						</Stack>
						<Card>
							<Paragraph marginBottom='space0'>{profileSummary}</Paragraph>
						</Card>
						</>
						)}
					</TabPanel>
				</TabPanels>
			</Tabs>
		</Card>
	);
};
export default withTaskContext(React.memo(DigitalChannelVirtualAssistant));
