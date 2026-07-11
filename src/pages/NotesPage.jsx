import { useEffect, useState } from "react";
import {
  Button,
  Divider,
  Flex,
  Grid,
  Heading,
  Image,
  Text,
  TextField,
  View,
} from "@aws-amplify/ui-react";
import { getUrl, uploadData } from "aws-amplify/storage";
import { noteModel, usesTodoFallback } from "../lib/amplifyClient";

function normalizeNote(record) {
  if (!usesTodoFallback) {
    return record;
  }

  try {
    return {
      id: record.id,
      ...JSON.parse(record.content || "{}"),
    };
  } catch {
    return {
      id: record.id,
      name: record.content || "Untitled",
      description: "",
      image: "",
    };
  }
}

function createNoteInput({ name, description, image }) {
  if (!usesTodoFallback) {
    return { name, description, image };
  }

  return {
    content: JSON.stringify({ name, description, image }),
  };
}

export default function NotesPage() {
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchNotes();
  }, []);

  async function fetchNotes() {
    if (!noteModel) {
      setError("利用できるデータモデルがありません。");
      return;
    }

    setError("");
    const { data: fetchedRecords } = await noteModel.list();
    const fetchedNotes = fetchedRecords.map(normalizeNote);
    const notesWithImages = await Promise.all(
      fetchedNotes.map(async (note) => {
        if (!note.image) {
          return note;
        }

        const linkToStorageFile = await getUrl({
          path: ({ identityId }) => `media/${identityId}/${note.image}`,
        });

        return {
          ...note,
          image: linkToStorageFile.url,
        };
      })
    );

    setNotes(notesWithImages);
  }

  async function createNote(event) {
    event.preventDefault();

    if (!noteModel) {
      setError("利用できるデータモデルがありません。");
      return;
    }

    const form = new FormData(event.target);
    const image = form.get("image");
    const imageName = image?.name || "";

    await noteModel.create(
      createNoteInput({
        name: form.get("name"),
        description: form.get("description"),
        image: imageName,
      })
    );

    if (imageName) {
      await uploadData({
        path: ({ identityId }) => `media/${identityId}/${imageName}`,
        data: image,
      }).result;
    }

    fetchNotes();
    event.target.reset();
  }

  async function deleteNote({ id }) {
    if (!noteModel) {
      setError("利用できるデータモデルがありません。");
      return;
    }

    await noteModel.delete({ id });
    fetchNotes();
  }

  return (
    <Flex
      className="notes-page"
      justifyContent="center"
      alignItems="center"
      direction="column"
      width="70%"
      margin="0 auto"
    >
      <Heading level={1}>My Notes App</Heading>
      <View as="form" margin="3rem 0" onSubmit={createNote}>
        <Flex
          direction="column"
          justifyContent="center"
          gap="2rem"
          padding="2rem"
        >
          <TextField
            name="name"
            placeholder="Note Name"
            label="Note Name"
            labelHidden
            variation="quiet"
            required
          />
          <TextField
            name="description"
            placeholder="Note Description"
            label="Note Description"
            labelHidden
            variation="quiet"
            required
          />
          <View
            name="image"
            as="input"
            type="file"
            alignSelf="end"
            accept="image/png, image/jpeg"
          />

          <Button type="submit" variation="primary">
            Create Note
          </Button>
        </Flex>
      </View>
      <Divider />
      {error && <Text color="red">{error}</Text>}
      <Heading level={2}>Current Notes</Heading>
      <Grid
        margin="3rem 0"
        templateColumns="repeat(3, minmax(0, 1fr))"
        justifyContent="center"
        gap="2rem"
        alignContent="center"
        width="100%"
      >
        {notes.map((note) => (
          <Flex
            key={note.id || note.name}
            direction="column"
            justifyContent="center"
            alignItems="center"
            gap="2rem"
            border="1px solid #ccc"
            padding="2rem"
            borderRadius="5%"
            className="box"
          >
            <View>
              <Heading level={3}>{note.name}</Heading>
            </View>
            <Text fontStyle="italic">{note.description}</Text>
            {note.image && (
              <Image
                src={note.image}
                alt={`visual aid for ${note.name}`}
                style={{ width: 400, maxWidth: "100%" }}
              />
            )}
            <Button variation="destructive" onClick={() => deleteNote(note)}>
              Delete note
            </Button>
          </Flex>
        ))}
      </Grid>
    </Flex>
  );
}
