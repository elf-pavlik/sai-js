--
-- PostgreSQL database dump
--

\restrict ns3zZ5ScjKa2AwMsyMRTwhBTGTUQnmzUq3X3ZFDfA7cBB0vAzfnaiRa34rf60ZL

-- Dumped from database version 16.10 (Debian 16.10-1.pgdg13+1)
-- Dumped by pg_dump version 16.10 (Debian 16.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE ONLY public.key_value DROP CONSTRAINT key_value_pkey;
DROP TABLE public.key_value;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: key_value; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.key_value (
    key text NOT NULL,
    value jsonb NOT NULL
);


--
-- Data for Name: key_value; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.key_value VALUES ('setup/v6-migration', '"true"');
INSERT INTO public.key_value VALUES ('setup/current-base-url', '"\"https://auth/\""');
INSERT INTO public.key_value VALUES ('setup/current-server-version', '"\"8.0.0-alpha.1\""');
INSERT INTO public.key_value VALUES ('idp/keys/cookie-secret', '"[\"1d3e45c34d0eeba2ce40c9a3e22916eabfe572207e02b69cf8f7ebc95cb134e3e3107236148bc4feecff7f9b3932c1473b5707af4d5353e8a13a35df9b8c0005\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/password/fe116276-ed94-4e87-8917-70b7985244b4', '"[\"9f942f30-2631-4403-9a1a-300f8faae267\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/password/d7c9cb32-9e18-4c9d-8998-491a22edd3f7', '"[\"e4fcefdc-5251-4e7c-9374-93ae71f188e3\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/password/email/alice%40acme.example', '"[\"e4fcefdc-5251-4e7c-9374-93ae71f188e3\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/password/email/kim%40encom.example', '"[\"9f942f30-2631-4403-9a1a-300f8faae267\"]"');
INSERT INTO public.key_value VALUES ('accounts/data/e4fcefdc-5251-4e7c-9374-93ae71f188e3', '"{\"linkedLoginsCount\":1,\"id\":\"e4fcefdc-5251-4e7c-9374-93ae71f188e3\",\"**uiPushSubscription**\":{},\"**reciprocalWebhook**\":{},\"**password**\":{\"d7c9cb32-9e18-4c9d-8998-491a22edd3f7\":{\"accountId\":\"e4fcefdc-5251-4e7c-9374-93ae71f188e3\",\"email\":\"alice@acme.example\",\"password\":\"$2b$10$lhqm/yiyPZfpc1SjXBCPneugEwn/LHDIPr9QRVIjvmJoJyAkyqV.G\",\"verified\":true,\"id\":\"d7c9cb32-9e18-4c9d-8998-491a22edd3f7\"}},\"**clientCredentials**\":{},\"**pod**\":{},\"**webIdLink**\":{\"823e97fa-7436-4cf7-8e84-72aa2ba56f68\":{\"webId\":\"https://id/alice\",\"accountId\":\"e4fcefdc-5251-4e7c-9374-93ae71f188e3\",\"id\":\"823e97fa-7436-4cf7-8e84-72aa2ba56f68\"}}}"');
INSERT INTO public.key_value VALUES ('accounts/index/webIdLink/823e97fa-7436-4cf7-8e84-72aa2ba56f68', '"[\"e4fcefdc-5251-4e7c-9374-93ae71f188e3\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/webIdLink/webId/https%3A%2F%2Fid/alice', '"[\"e4fcefdc-5251-4e7c-9374-93ae71f188e3\"]"');
INSERT INTO public.key_value VALUES ('accounts/data/9f942f30-2631-4403-9a1a-300f8faae267', '"{\"linkedLoginsCount\":1,\"id\":\"9f942f30-2631-4403-9a1a-300f8faae267\",\"**uiPushSubscription**\":{},\"**reciprocalWebhook**\":{},\"**password**\":{\"fe116276-ed94-4e87-8917-70b7985244b4\":{\"accountId\":\"9f942f30-2631-4403-9a1a-300f8faae267\",\"email\":\"kim@encom.example\",\"password\":\"$2b$10$F.yfLO/WTd31fD.GuswWbui/./pXpOPH1VtMTYcTdt0dPdYkEim.y\",\"verified\":true,\"id\":\"fe116276-ed94-4e87-8917-70b7985244b4\"}},\"**clientCredentials**\":{},\"**pod**\":{},\"**webIdLink**\":{\"678b68db-3d29-428a-b339-6e3f8b285de9\":{\"webId\":\"https://id/kim\",\"accountId\":\"9f942f30-2631-4403-9a1a-300f8faae267\",\"id\":\"678b68db-3d29-428a-b339-6e3f8b285de9\"}}}"');
INSERT INTO public.key_value VALUES ('accounts/index/password/958d5f04-57df-4cff-a848-06efab13a2b0', '"[\"281efdff-8a0a-4f57-b058-250717899fae\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/password/email/bob%40yoyodyne.example', '"[\"281efdff-8a0a-4f57-b058-250717899fae\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/webIdLink/678b68db-3d29-428a-b339-6e3f8b285de9', '"[\"9f942f30-2631-4403-9a1a-300f8faae267\"]"');
INSERT INTO public.key_value VALUES ('accounts/data/281efdff-8a0a-4f57-b058-250717899fae', '"{\"linkedLoginsCount\":1,\"id\":\"281efdff-8a0a-4f57-b058-250717899fae\",\"**uiPushSubscription**\":{},\"**reciprocalWebhook**\":{},\"**password**\":{\"958d5f04-57df-4cff-a848-06efab13a2b0\":{\"accountId\":\"281efdff-8a0a-4f57-b058-250717899fae\",\"email\":\"bob@yoyodyne.example\",\"password\":\"$2b$10$UHVDmpuo.Tb1NMluxY/OMOvxFpqXYi3/5ZW2b5FxReJb3bG.U1f1.\",\"verified\":true,\"id\":\"958d5f04-57df-4cff-a848-06efab13a2b0\"}},\"**clientCredentials**\":{},\"**pod**\":{},\"**webIdLink**\":{\"fcc56d5b-599f-495a-ba09-d23db6c711d2\":{\"webId\":\"https://id/bob\",\"accountId\":\"281efdff-8a0a-4f57-b058-250717899fae\",\"id\":\"fcc56d5b-599f-495a-ba09-d23db6c711d2\"}}}"');
INSERT INTO public.key_value VALUES ('accounts/index/webIdLink/fcc56d5b-599f-495a-ba09-d23db6c711d2', '"[\"281efdff-8a0a-4f57-b058-250717899fae\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/webIdLink/webId/https%3A%2F%2Fid/bob', '"[\"281efdff-8a0a-4f57-b058-250717899fae\"]"');
INSERT INTO public.key_value VALUES ('accounts/index/webIdLink/webId/https%3A%2F%2Fid/kim', '"[\"9f942f30-2631-4403-9a1a-300f8faae267\"]"');


--
-- Name: key_value key_value_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_value
    ADD CONSTRAINT key_value_pkey PRIMARY KEY (key);


--
-- PostgreSQL database dump complete
--

\unrestrict ns3zZ5ScjKa2AwMsyMRTwhBTGTUQnmzUq3X3ZFDfA7cBB0vAzfnaiRa34rf60ZL

